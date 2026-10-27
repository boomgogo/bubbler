// A p3p2 server on this machine, for racing and testing without a server of your own.
//   npm run p3p2              the server on port 8080, a room for the dev server and the preview, and its invite
//   npm run p3p2 -- --lag     also a proxy on 8081 that adds 150 ms, jitter, and a cut every 30 s
// The first run fetches the p3p2 repository (a pinned commit) into .p3p2/src and installs the
// server's few dependencies; .p3p2/ is ignored by git. The room is kept in .p3p2/data and reused.
// tools/check-mp.js uses the same functions, with a server and a room of its own.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(import.meta.dirname, '..', '.p3p2');
const SRC = join(ROOT, 'src');
const REPO = 'https://github.com/doublependu/p3p2';
const COMMIT = '4602190b58148d41362fd53704bf090bff3cfeb9'; // p3p2 0.2.0, the server @p3p2/client 0.2.0 was released with
const PASSWORD = 'bubbler-local-only'; // the portal's owner password; the server only listens for this machine's tests and LAN

// This machine's address on the local network: phones on the same Wi-Fi reach the game and the server there.
export function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '127.0.0.1';
}

// Fetches the server's source and its dependencies, once, and again when the pinned commit changes.
export function install() {
  if (existsSync(join(SRC, 'node_modules', 'hono')) && head() === COMMIT) return;
  console.log(`Fetching the p3p2 server (${COMMIT.slice(0, 7)}) into .p3p2/src …`);
  mkdirSync(SRC, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: SRC, stdio: 'inherit' });
  if (!existsSync(join(SRC, '.git'))) git('init', '-q');
  git('fetch', '-q', '--depth', '1', REPO, COMMIT);
  git('checkout', '-q', COMMIT);
  execFileSync('npm', ['ci', '--workspace', 'server', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: SRC, stdio: 'inherit' });
}

// The commit .p3p2/src is at, or null.
function head() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: SRC, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

async function until(url, seconds = 15) {
  for (const end = Date.now() + seconds * 1000; Date.now() < end; ) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`${url} did not answer`);
}

// Starts a server. `publicUrl` is how players reach it: invites are built from it.
export async function startServer({ port = 8080, publicUrl = `http://${lanAddress()}:${port}`, data = join(ROOT, 'data'), quiet = false } = {}) {
  install();
  mkdirSync(data, { recursive: true });
  const child = spawn(process.execPath, ['src/main.ts'], {
    cwd: join(SRC, 'server'),
    stdio: quiet ? 'ignore' : 'inherit',
    env: {
      ...process.env,
      P3P2_PORT: String(port),
      P3P2_PUBLIC_URL: publicUrl,
      P3P2_DATA_DIR: data,
      P3P2_OWNER_PASSWORD: PASSWORD,
      // Every test player comes from this one machine, and the limits are per address.
      P3P2_CONNECT_RATE: '20',
      P3P2_API_RATE: '50',
      P3P2_LOG_LEVEL: quiet ? 'warn' : 'info',
    },
  });
  const local = `http://127.0.0.1:${port}`;
  await until(`${local}/healthz`);
  return { url: local, publicUrl, child, stop: () => child.kill() };
}

// Logs in to the portal as its owner. Its forms only count when they come from its own site.
async function login(server) {
  const res = await fetch(`${server.url}/login`, {
    method: 'POST',
    headers: { origin: server.url },
    body: new URLSearchParams({ password: PASSWORD }),
    redirect: 'manual',
  });
  if (res.status !== 302) throw new Error(`the portal refused the owner password (${res.status})`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

// A form post to the portal, as its owner. Returns the page it sends the browser to.
async function post(server, path, form) {
  const res = await fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { origin: server.url, cookie: await login(server) },
    body: new URLSearchParams(form),
    redirect: 'manual',
  });
  const where = res.headers.get('location');
  if (res.status !== 302 || !where) throw new Error(`the portal refused ${path} (${res.status})`);
  return where;
}

const key = (page) => new URL(page).pathname.split('/room/')[1];

// Creates a room for the game at `game` (and the sites in `origins`), as the portal's forms do: the
// room first, then its settings for the other sites. Returns the room's page in the portal and its invite link.
export async function createRoom(server, { game, origins = [], name = 'Bubbler', players = 16 }) {
  const where = await post(server, '/rooms', { game, name, max: String(players) });
  if (!where.startsWith('/room/')) throw new Error(`the portal did not make a room (${where})`);
  const page = server.publicUrl + where;
  if (origins.length) await post(server, `/room/${key(page)}/settings`, { name, max: String(players), origins: origins.join('\n') });
  return { page, invite: await roomInvite(server, page) };
}

// The room's invite link: the room page's Open link. An invite expires once the room has been empty
// for a while (12 hours), so one is made when the room has none.
export async function roomInvite(server, page) {
  for (let tries = 0; tries < 2; tries++) {
    const res = await fetch(`${server.url}/room/${key(page)}`, { headers: { cookie: await login(server) } });
    if (!res.ok) throw new Error(`the portal did not show the room (${res.status})`);
    const open = (await res.text()).match(/<a class="button" href="([^"]+)"[^>]*>Open<\/a>/);
    if (open) return open[1].replaceAll('&amp;', '&');
    await post(server, `/room/${key(page)}/invite`, {});
  }
  throw new Error('the room has no invite');
}

// Ends the room's game, as the owner does on its page: everyone in it is told, and its invite stops working.
export async function endRoom(server, page) {
  await post(server, `/room/${key(page)}/end`, {});
}

async function roomExists(server, page) {
  const res = await fetch(`${server.url}/room/${key(page)}`, { headers: { cookie: await login(server) }, redirect: 'manual' });
  return res.status === 200;
}

// Starts p3p2's lag proxy in front of the server.
export function startLag({ listen = 8081, to = 8080, latency = 150, jitter = 50, dropEvery = 30 } = {}) {
  const args = ['e2e/tools/lag-proxy.ts', '--listen', listen, '--to', `127.0.0.1:${to}`, '--latency', latency, '--jitter', jitter, '--drop-every', dropEvery];
  return spawn(process.execPath, args.map(String), { cwd: SRC, stdio: 'inherit' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lan = lanAddress();
  const server = await startServer();
  let lag = null;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.stop();
      lag?.kill();
      process.exit(0);
    });
  }
  // The dev server (npm run dev -- --host) and the preview, at this machine's LAN address and on localhost.
  const sites = [5173, 4173].flatMap((port) => [`http://${lan}:${port}`, `http://localhost:${port}`]);
  const saved = join(ROOT, 'room.json');
  let room = existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')) : null;
  // A room saved by the 0.1 version of this tool has a room URL and no page.
  if (!room?.page || room.sites.join() !== sites.join() || !(await roomExists(server, room.page))) {
    room = { page: (await createRoom(server, { game: sites[0], origins: sites.slice(1) })).page, sites };
    writeFileSync(saved, JSON.stringify(room, null, 2));
  }
  // Never saved: it changes when it expires.
  const invite = await roomInvite(server, room.page);
  const preview = invite.replace(`${sites[0]}/`, `http://${lan}:4173/`);
  console.log(`\nInvite link, for the dev server (\`npm run dev -- --host\`):\n  ${invite}`);
  console.log(`The same for the preview (\`npm run preview -- --host\`):\n  ${preview}`);
  console.log(`The room takes the game at ${sites.join(', ')}: the part after ?room= works on each.`);
  console.log('Open it in two browsers (not two tabs of one: that is one player), or on a phone on the same Wi-Fi.');
  if (process.argv.includes('--lag')) {
    lag = startLag();
    console.log(`\nThrough the lag proxy (150 ms each way, jitter, a cut every 30 s):\n  ${invite.replace(':8080/', ':8081/')}`);
  }
  console.log('\nThe portal is at', server.publicUrl, `(owner password: ${PASSWORD}). Ctrl+C stops the server.`);
}

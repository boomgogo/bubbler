// Races in real browsers, against a p3p2 server on this machine (tools/p3p2-local.js): Chrome,
// Firefox and WebKit in one room, on the built site, each player a browser profile of its own.
//   npm run build && npm run check:mp            [-- --lag] [-- --headed]
// --lag puts p3p2's lag proxy between the players and the server: 150 ms each way, jitter, and
// every connection cut now and then. Shots are chosen in Node by the greedy bot and fired through
// the page's debug handle; the panel, the race line, the standings and the watch bar are used by
// clicking them, as a player would.
import { chromium, firefox, webkit } from 'playwright-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from './serve.js';
import { startServer, createRoom, startLag } from './p3p2-local.js';
import { Game, clampAim } from '../src/core/game.js';
import { applyShot } from '../src/core/rules.js';
import { createRng } from '../src/core/rng.js';
import { FAIL_ROW } from '../src/config.js';
import { greedyPolicy } from './sim-bot.js';

const LAG = process.argv.includes('--lag');
const HEADED = process.argv.includes('--headed');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, { timeout = 10_000, every = 150 } = {}) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await fn().catch(() => undefined);
    if (value) return value;
    await sleep(every);
  }
  return value;
}

// ---- The site, the server, a room ----

const site = await serve(join(import.meta.dirname, '..', 'dist'));
const GAME = `http://127.0.0.1:${site.address().port}/?debug`;
const port = 18_000 + Math.floor(Math.random() * 1000);
const server = await startServer({ port, publicUrl: `http://127.0.0.1:${port}`, data: mkdtempSync(join(tmpdir(), 'bubbler-p3p2-')), quiet: true });
let lag = null;
process.on('exit', () => {
  server.stop();
  lag?.kill();
});
let roomUrl = await createRoom(server, { game: GAME, name: 'Bubbler test' });
if (LAG) {
  lag = startLag({ listen: port + 1, to: port, latency: 150, jitter: 50, dropEvery: 25 });
  await sleep(500);
  roomUrl = roomUrl.replace(`:${port}/`, `:${port + 1}/`);
}
console.log(`site ${GAME}\nroom ${roomUrl}${LAG ? ' (through the lag proxy)' : ''}\n`);

const GPU = ['--enable-gpu', '--ignore-gpu-blocklist'];
const engines = { chrome: await chromium.launch({ channel: 'chrome', headless: !HEADED, args: GPU }), firefox: await firefox.launch({ headless: !HEADED }) };
const NAMES = { chrome: 'Chrome', firefox: 'Firefox', webkit: 'WebKit' };
try {
  engines.webkit = await webkit.launch({ headless: !HEADED });
} catch {
  NAMES.webkit = 'Firefox (standing in for WebKit)';
  // Playwright's WebKit needs system libraries that only `sudo npx playwright install-deps webkit` adds.
  console.log('! WebKit could not start on this machine (run `sudo npx playwright install-deps webkit`): its player uses Firefox.\n');
  engines.webkit = engines.firefox;
}
const errors = [];

async function player(name, engine, options = {}) {
  const context = await engines[engine].newContext({ viewport: { width: 900, height: 900 }, ...options });
  const page = await context.newPage();
  // Firefox reports work cut short by a reload as an error; the reloads here are deliberate.
  const noise = /WebGL|GPU|GL_|Navigated away from page/i;
  page.on('pageerror', (e) => !noise.test(e.message) && errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !noise.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  return { name, engine, context, page };
}

const evaluate = (p, fn, arg) => p.page.evaluate(fn, arg);
const title = (p) => evaluate(p, () => !document.getElementById('btn-play').hidden && document.getElementById('btn-play').textContent);

// Until a shot can be taken: fly-overs skipped, cards waited out.
async function ready(p, timeout = 20_000) {
  return poll(() => evaluate(p, () => {
    const b = window.__bubbler;
    if (b.view.flight) b.view.skipFlight();
    return b.ready;
  }), { timeout });
}

// A shot aimed anywhere, from a seeded draw, that neither clears the level nor brings the bubbles
// near the launcher: it keeps a level going for as long as a test needs it.
const aimless = createRng(20261022);
function idleAngle(game) {
  for (let i = 0; i < 40; i++) {
    const angle = clampAim(0.3 + aimless.next() * 2.5);
    const board = game.board.clone();
    applyShot(board, game.active, game.origin.x, game.origin.y, angle);
    const lowest = board.lowestRow();
    if (lowest >= 0 && lowest - game.scrollRow < FAIL_ROW - 4) return angle;
  }
  return Math.PI / 2;
}

// One shot, aimed by the greedy bot at the bubble in hand. `bad` aims anywhere (above).
async function shoot(p, { bad = false } = {}) {
  if (!(await ready(p))) {
    const why = await evaluate(p, () => {
      const b = window.__bubbler;
      const shown = [...document.querySelectorAll('.screen')].filter((el) => !el.hidden && !el.classList.contains('out')).map((el) => el.id);
      return { phase: b.game.phase, moves: b.game.moves, level: b.game.level, watching: b.app.watching, flight: !!b.view.flight, shown };
    });
    throw new Error(`${p.name} is not ready to shoot: ${JSON.stringify(why)}`);
  }
  const state = await evaluate(p, () => window.__bubbler.game.serialize());
  const copy = Game.load(state);
  copy.hand = [copy.hand[0], copy.hand[0]];
  const angle = bad ? idleAngle(copy) : greedyPolicy(copy, 60).angle;
  await evaluate(p, (a) => window.__bubbler.fireAt(a), angle);
}

async function host(p) {
  await p.page.goto(GAME);
  await p.page.locator('#btn-friends').click();
  await p.page.getByLabel('Your name').fill(p.name);
  await p.page.getByLabel('Room URL').fill(roomUrl);
  await p.page.getByRole('status').filter({ hasText: '✓' }).waitFor();
  await p.page.getByRole('button', { name: 'Create a multiplayer game room for my friends' }).click();
  const link = p.page.getByLabel('Invite link', { exact: true });
  await link.waitFor();
  return link.inputValue();
}

async function accept(p, invite) {
  await p.page.goto(invite);
  const yes = p.page.getByRole('button', { name: 'Join', exact: true });
  await yes.waitFor();
  await p.page.getByLabel('Your name').fill(p.name);
  await yes.click();
}

// Closes p3p2's panel if it is open, so it is not over the game's buttons.
async function closePanel(p) {
  const close = p.page.getByRole('button', { name: 'Close', exact: true });
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function start(p) {
  await poll(async () => (await title(p)) === 'Start the race');
  await closePanel(p);
  await p.page.locator('#btn-play').click();
  return ready(p);
}

const race = (p) => evaluate(p, () => {
  const r = window.__bubbler.race;
  return r && { mine: r.mine, seed: window.__bubbler.app.own.seed, self: r.room.self.id, pid: r.room.self.pid };
});
// The standings sheet as the player sees it.
const rows = (p) => evaluate(p, () => [...document.querySelectorAll('#standings-rows .srow')].map((el) => ({
  name: el.querySelector('.who').firstChild.textContent,
  score: Number(el.querySelector('b').textContent.replace(/,/g, '')),
  note: el.querySelector('small').textContent,
  gone: el.classList.contains('gone'),
  watch: el.querySelector('button') ? !el.querySelector('button').disabled : null,
})));
const own = (p) => evaluate(p, () => ({ score: window.__bubbler.app.own.score, level: window.__bubbler.app.own.level, state: window.__bubbler.state() }));

try {
  // ---- Ada opens a room, Bo joins from the invite ----
  const ada = await player('Ada', 'chrome');
  const invite = await host(ada);
  check('the panel turns a room URL into an invite link', invite.includes('room='), invite);
  const bo = await player('Bo', 'firefox');
  await accept(bo, invite);
  check('Ada and Bo start the race', !!(await start(ada)) && !!(await start(bo)));
  const [ra, rb] = [await race(ada), await race(bo)];
  check('they are in the same race, with one seed', ra.mine === rb.mine && ra.seed === rb.seed, `race ${ra.mine}, seed ${ra.seed}`);

  // ---- The same boards and colours in every engine ----
  const cy = await player('Cy', 'webkit');
  await cy.page.goto(GAME);
  await poll(() => title(cy));
  const prints = {};
  for (const p of [ada, bo, cy]) {
    prints[p.engine] = await evaluate(p, (seed) => Array.from({ length: 40 }, (_, i) => window.__bubbler.fingerprint(i + 1, seed)), ra.seed);
  }
  const same = prints.chrome.every((h, i) => h === prints.firefox[i] && h === prints.webkit[i]);
  check(`Chrome, Firefox and ${NAMES.webkit} build the same boards and queues, levels 1–40`, same, same ? '' : `first difference at level ${prints.chrome.findIndex((h, i) => h !== prints.firefox[i] || h !== prints.webkit[i]) + 1}`);

  // ---- The race line and the standings ----
  // Shots aimed anywhere: Ada stays on level 1 for now, so Bo may watch her below.
  for (let i = 0; i < 3; i++) await shoot(ada, { bad: true });
  await ready(ada);
  const adaNow = await own(ada);
  const seen = await poll(async () => {
    await bo.page.locator('#race-line').click();
    const r = await rows(bo);
    await bo.page.locator('#btn-standings-close').click();
    return r.find((x) => x.name === 'Ada' && x.score === adaNow.score) && r;
  }, { timeout: 8000, every: 400 });
  check("Ada's score reaches Bo's standings", !!seen, `Ada ${adaNow.score}`);
  const line = await bo.page.locator('#race-line').textContent();
  // Until someone has scored there is no order to speak of.
  check('the race line says where Bo stands', adaNow.score > 0 ? /2nd of 2 · Ada leads/.test(line) : /2 in the race/.test(line), line);

  // ---- Watching ----
  // Bo stays on level 1 (one good shot can clear it, and every player is dealt the same), so that
  // Ada, who goes on below, is ahead of him.
  await shoot(bo, { bad: true });
  await ready(bo);
  const boBefore = await own(bo);
  await bo.page.locator('#race-line').click();
  await bo.page.locator('#standings-rows .srow', { hasText: 'Ada' }).getByRole('button', { name: 'Watch' }).click();
  const watching = await poll(() => evaluate(bo, () => window.__bubbler.app.watching));
  check('Bo watches Ada', !!watching, await bo.page.locator('#watch-name').textContent());
  // Ada aims with the mouse: Bo sees her aim line where she has it.
  await ready(ada);
  let aims = 0;
  for (const [x, y] of [[450, 300], [250, 420], [700, 380]]) {
    await ada.page.mouse.move(x, y, { steps: 4 });
    const her = await evaluate(ada, () => window.__bubbler.aim);
    const ok = her !== null && (await poll(() => evaluate(bo, (a) => window.__bubbler.aim !== null && Math.abs(window.__bubbler.aim - a) < 0.01, her), { timeout: 4000 }));
    if (ok) aims++;
  }
  check("Bo sees Ada's aim line move as she aims", aims === 3, `${aims} of 3 aims followed`);
  // Shots aimed anywhere keep Ada on this level for a while.
  let matched = 0;
  const level = (await own(ada)).level;
  for (let i = 0; i < 15; i++) {
    await shoot(ada, { bad: true });
    await ready(ada);
    const a = await own(ada);
    if (a.level !== level) break;
    const ok = await poll(() => evaluate(bo, (s) => window.__bubbler.app.watching && window.__bubbler.state() === s, a.state), { timeout: 8000 });
    if (!ok) break;
    matched++;
  }
  check("Bo's screen shows Ada's board after each of her shots", matched === 15, `${matched} of 15 shots matched`);
  // Now she clears the level, and goes on to one Bo has not reached.
  for (let i = 0; i < 40 && (await own(ada)).level === level; i++) await shoot(ada);
  await ready(ada);
  const adaAfter = await own(ada);
  const back = await poll(() => evaluate(bo, () => !window.__bubbler.app.watching));
  check('when Ada goes on to a level Bo has not reached, Bo is taken back to his own game', adaAfter.level > boBefore.level && !!back, `Ada on level ${adaAfter.level}`);

  const boAfter = await own(bo);
  check("Bo's own run is as he left it", boAfter.state === boBefore.state && boAfter.score === boBefore.score);
  await ready(bo);
  const blocked = await poll(async () => {
    await bo.page.locator('#race-line').click();
    const r = (await rows(bo)).find((x) => x.name === 'Ada');
    await bo.page.locator('#btn-standings-close').click();
    return r && r.watch === false && r;
  });
  check('Watch is off for a player ahead of you', !!blocked, blocked?.note);

  // ---- Reloads ----
  for (const p of [bo, ada]) {
    const before = await own(p);
    await p.page.reload();
    const label = await poll(async () => {
      const t = await title(p);
      return t?.startsWith('Continue the race') && t;
    }, { timeout: 15_000 });
    await closePanel(p);
    await p.page.locator('#btn-play').click();
    await ready(p);
    const after = await own(p);
    const r = await race(p);
    check(`${p.name}'s reload resumes the race run where it stood`, !!label && after.state === before.state && r?.mine === ra.mine, label);
  }

  // ---- A late joiner, and a player who leaves ----
  await accept(cy, invite);
  await start(cy);
  const rc = await race(cy);
  check(`Cy, joining late in ${NAMES.webkit}, gets the same race`, rc.mine === ra.mine && rc.seed === ra.seed);
  await shoot(cy);
  const boLeft = await own(bo);
  await bo.page.keyboard.press('Escape');
  await bo.page.locator('#btn-leave').click();
  const solo = await poll(() => evaluate(bo, () => !document.documentElement.classList.contains('racing') && !window.__bubbler.race));
  check('Bo leaves the race and is back in his own game', !!solo);
  const dee = await player('Dee', 'chrome');
  await accept(dee, invite);
  await start(dee);
  const deeRows = await poll(async () => {
    await dee.page.locator('#race-line').click();
    const r = await rows(dee);
    await dee.page.locator('#btn-standings-close').click();
    return r.find((x) => x.name === 'Bo' && x.gone && x.score === boLeft.score) && r;
  }, { timeout: 8000, every: 400 });
  check("Dee, who came after Bo left, still sees Bo's standing", !!deeRows, deeRows?.map((x) => `${x.name} ${x.score} ${x.note}`).join('; '));
  check('Ada, back after her reload, shows as playing', !!deeRows?.find((x) => x.name === 'Ada' && x.note.includes('playing') && !x.note.includes('about to start')));

  // Dee's run ends at once; a finished player may watch anyone. She watches Cy play through a level change.
  await ready(dee);
  await evaluate(dee, () => {
    window.__bubbler.game.moves = 1;
    window.__bubbler.game.gems = 0;
  });
  await shoot(dee, { bad: true });
  await poll(() => dee.page.locator('#btn-end').isVisible(), { timeout: 15_000 });
  await dee.page.locator('#btn-end').click();
  await dee.page.locator('#over-standings .srow', { hasText: 'Cy' }).getByRole('button', { name: 'Watch' }).click();
  await poll(() => evaluate(dee, () => window.__bubbler.app.watching));
  const cyLevel = (await own(cy)).level;
  let followed = 0;
  let through = false;
  for (let i = 0; i < 40 && followed < 30; i++) {
    await shoot(cy);
    await ready(cy);
    const c = await own(cy);
    const ok = await poll(() => evaluate(dee, (s) => window.__bubbler.app.watching && window.__bubbler.state() === s, c.state), { timeout: 10_000 });
    if (!ok) break;
    followed++;
    if (c.level > cyLevel) {
      through = true;
      if (followed >= 3) break;
    }
  }
  check(`Dee (Chrome) follows Cy (${NAMES.webkit}) shot for shot, through a level change`, through, `${followed} shots, Cy on level ${(await own(cy)).level}`);
  await dee.page.screenshot({ path: join(tmpdir(), 'bubbler-race-watch.png') });
  await dee.page.locator('#watch-back').click();
  const deeBack = await poll(() => dee.page.locator('#over').isVisible());
  check("back from watching, Dee's own finished run shows its card again", !!deeBack);

  // ---- Rematch ----
  // Ada's run ends (moves set to one by hand, then a shot), and she starts a new race from the card.
  await ready(ada);
  await evaluate(ada, () => {
    window.__bubbler.game.moves = 1;
    window.__bubbler.game.gems = 0;
  });
  await shoot(ada, { bad: true });
  await poll(() => ada.page.locator('#btn-end').isVisible(), { timeout: 15_000 });
  await ada.page.locator('#btn-end').click();
  await ada.page.locator('#btn-rematch').waitFor();
  const overRows = await ada.page.locator('#over-standings .srow').count();
  check('the game-over card shows the race standings', overRows >= 3, `${overRows} rows`);
  await ada.page.locator('#btn-rematch').click();
  const fresh = await poll(async () => {
    const r = await race(ada);
    return r.mine !== ra.mine && r;
  });
  check('Rematch starts a new race with a new seed', !!fresh && fresh.seed !== ra.seed, fresh && `race ${fresh.mine}`);
  await ready(ada);
  const cyStays = await poll(async () => {
    const r = await race(cy);
    const cls = await cy.page.locator('#race-line').getAttribute('class');
    return r.mine === ra.mine && cls?.includes('new') && r;
  });
  check('Cy, mid-run, stays in her race and is offered the new one', !!cyStays);
  await ada.page.locator('#race-line').click();
  const between = await ada.page.locator('#standings-sub').textContent();
  await ada.page.locator('#btn-standings-close').click();
  check("Ada's standings name those still in the old race", /Between races: .*Cy/.test(between), between);
  await cy.page.locator('#race-line').click();
  await cy.page.locator('#btn-join-new').click();
  const cyNew = await poll(async () => {
    const r = await race(cy);
    return r.mine === fresh.mine && r;
  });
  check('Cy joins the new race and gets its seed', !!cyNew && cyNew.seed === fresh.seed);

  // ---- A phone ----
  const phone = await player('Eve', 'chrome', { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await accept(phone, invite);
  await start(phone);
  for (const [w, h] of [[360, 640], [640, 360]]) {
    await phone.page.setViewportSize({ width: w, height: h });
    await sleep(400);
    const boxes = await evaluate(phone, () => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      const fy = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fy'));
      const race = box('race');
      const hit = ['moves', 'boost-comet', 'boost-clear', 'gems'].filter((id) => {
        const b = box(id);
        return !(b.bottom <= race.top || b.top >= race.bottom || b.right <= race.left || b.left >= race.right);
      });
      return { raceBottom: race.bottom, fieldTop: fy, hit, fits: race.right <= innerWidth && race.left >= 0 };
    });
    check(`on a ${w}×${h} phone the race line sits above the bubbles and covers no control`, boxes.raceBottom <= boxes.fieldTop + 1 && !boxes.hit.length && boxes.fits, JSON.stringify(boxes));
    await phone.page.screenshot({ path: join(tmpdir(), `bubbler-race-${w}x${h}.png`) });
  }

  // ---- What it costs to watch, on a slow phone ----
  // Eve plays on the low tier with the CPU slowed 4×; frame rate while her own game waits, then
  // while she watches Ada take shots.
  const cdp = await phone.context.newCDPSession(phone.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await phone.page.setViewportSize({ width: 360, height: 640 });
  await evaluate(phone, () => window.__bubbler.view.quality.setTier('low', true));
  const fps = async (seconds) => {
    const samples = [];
    for (let t = 0; t < seconds * 4; t++) {
      await sleep(250);
      samples.push(await evaluate(phone, () => window.__bubbler.view.stats.fps));
    }
    samples.sort((a, b) => a - b);
    return samples[samples.length >> 1];
  };
  await ready(phone);
  const alone = await fps(5);
  await phone.page.locator('#race-line').click();
  await phone.page.locator('#standings-rows .srow', { hasText: 'Ada' }).getByRole('button', { name: 'Watch' }).click();
  await poll(() => evaluate(phone, () => window.__bubbler.app.watching));
  const shots = (async () => {
    for (let i = 0; i < 6; i++) await shoot(ada, { bad: true });
  })();
  const watchingFps = await fps(5);
  await shots;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  check('watching costs no more frame rate than playing (phone profile, CPU 4× slower, low tier)', watchingFps >= alone * 0.9, `${alone.toFixed(0)} fps playing, ${watchingFps.toFixed(0)} fps watching`);
  await phone.page.locator('#watch-back').click();

  // ---- The screens, for a person to look at ----
  const shots2 = [['title', 360, 640], ['title', 640, 360]];
  for (const [name, w, h] of shots2) {
    const p = await player('Shot', 'chrome', { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.page.goto(GAME);
    await poll(() => title(p));
    const fits = await evaluate(p, () => {
      const inner = document.querySelector('#title > div');
      const links = document.querySelector('#title .links').getBoundingClientRect();
      return inner.scrollHeight <= inner.clientHeight + 1 || links.bottom <= innerHeight;
    });
    check(`the title screen fits a ${w}×${h} phone, links included (or scrolls to them)`, fits);
    await p.page.screenshot({ path: join(tmpdir(), `bubbler-${name}-${w}x${h}.png`) });
    await p.context.close();
  }
  // Each after its fade has finished.
  await phone.page.locator('#race-line').click();
  await sleep(500);
  await phone.page.screenshot({ path: join(tmpdir(), 'bubbler-race-standings.png') });
  await phone.page.locator('#btn-standings-close').click();
  await sleep(500);
  await phone.page.keyboard.press('Escape');
  await sleep(500);
  await phone.page.screenshot({ path: join(tmpdir(), 'bubbler-race-pause.png'), fullPage: true });
  await phone.page.keyboard.press('Escape');
  console.log(`  screenshots in ${tmpdir()}/bubbler-*.png`);

  // ---- A room opened in the middle of a solo game ----
  const gus = await player('Gus', 'chrome');
  await gus.page.goto(GAME);
  await poll(() => title(gus));
  await gus.page.locator('#btn-play').click();
  await shoot(gus, { bad: true });
  await shoot(gus, { bad: true });
  await ready(gus);
  const soloBefore = await own(gus);
  await gus.page.keyboard.press('Escape');
  await gus.page.locator('#btn-friends-p').click();
  await gus.page.getByLabel('Your name').fill('Gus');
  await gus.page.getByLabel('Room URL').fill(await createRoom(server, { game: GAME, name: 'Second room' }));
  await gus.page.getByRole('status').filter({ hasText: '✓' }).waitFor();
  await gus.page.getByRole('button', { name: 'Create a multiplayer game room for my friends' }).click();
  await gus.page.locator('#race-start').waitFor();
  const waited = await own(gus);
  check('opening a room mid-game asks before the race starts, and the solo game waits', waited.state === soloBefore.state);
  await closePanel(gus);
  await gus.page.locator('#btn-race-start').click();
  const raced = await ready(gus);
  const gusRun = await evaluate(gus, () => ({ shots: window.__bubbler.game.stats.shots, paused: !document.getElementById('pause').hidden }));
  check('"Start the race" starts a fresh race run, unpaused', !!raced && gusRun.shots === 0 && !gusRun.paused);
  await shoot(gus);
  await gus.page.keyboard.press('Escape');
  await gus.page.locator('#btn-leave').click();
  const soloAgain = await poll(async () => {
    const o = await own(gus);
    return !(await evaluate(gus, () => document.documentElement.classList.contains('racing'))) && o.state === soloBefore.state && o;
  });
  check('leaving the race brings back the solo game exactly as it was', !!soloAgain);

  // ---- An ordinary visit ----
  const visitor = await player('Fay', 'chrome');
  const requests = [];
  visitor.page.on('request', (r) => requests.push(r.url()));
  await visitor.page.goto(GAME);
  await poll(() => title(visitor));
  await sleep(1500);
  const extra = requests.filter((u) => u.includes(`:${port}`) || u.includes(`:${port + 1}`) || /p3p2-(core|panel|qr)|race-/.test(u));
  check('an ordinary visit asks no p3p2 server anything and loads no race code', !extra.length, extra.join(' '));

  // ---- The room closed by whoever hosts it ----
  await evaluate(ada, () => window.__bubbler.race.room.end());
  const closedCard = await poll(async () => (await cy.page.locator('#room-closed').isVisible()) && cy.page.locator('#room-closed-why').textContent());
  check('when the host ends the room, the others are told why', !!closedCard, closedCard);
  await cy.page.locator('#btn-room-back').click();
  const cySolo = await poll(() => evaluate(cy, () => !document.documentElement.classList.contains('racing') && !window.__bubbler.race && !window.__bubbler.app.watching));
  check('"Back to my game" leaves Cy in her own solo game', !!cySolo);
} catch (error) {
  console.error(error);
  results.push(false);
} finally {
  if (errors.length) console.log('\nErrors on the pages:\n ', errors.slice(0, 20).join('\n  '));
  for (const b of Object.values(engines)) await b.close().catch(() => {});
  server.stop();
  lag?.kill();
  site.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed${errors.length ? `, ${errors.length} page errors` : ''}.`);
process.exit(failed || errors.length ? 1 : 0);

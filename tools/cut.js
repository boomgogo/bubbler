// Makes the finished pieces from a recorded run (tools/record.js youtube):
//   youtube  the text to paste (titles, description with chapters, tags) and thumbnail stills
//   short    a YouTube Short: highlights of the run re-rendered in a phone layout, played by touch
//   x        a square video for X, cut from the YouTube recording
// Usage: node tools/cut.js youtube|short|x [--run recordings/youtube]
// Needs ffmpeg; `short` also needs Chrome and the built site, as it records again.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RECORDINGS, SITE_URL, ffmpeg, X264, TAG_709, encodeAudio, recordPiece, clock } from './record.js';
import { REPO_URL } from '../site.config.js';
import { PLACES, placeOf } from '../src/config.js';
import { playRun } from './autoplay.js';

const NAMES = { lake: 'Lantern Lake', fjord: 'Aurora Fjord', marsh: 'Firefly Marsh', lagoon: 'Glow Lagoon', harbour: 'Neon Harbour' };
const FONT_LIGHT = '/usr/share/fonts/truetype/ubuntu/Ubuntu-L.ttf';
const FONT = '/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf';
const SITE = SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const XFADE = 0.25; // seconds of crossfade between pieces

const loadRun = (dir) => withStates({ dir, master: join(dir, `bubbler-${basename(dir)}.mp4`), ...JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) });

// The state before each turn, for re-recording a moment. A run that matched its prediction is
// replayed from its seed, which gives the states exactly.
function withStates(run) {
  if (run.diverged != null) return run;
  const states = [];
  playRun(run.seed, { onTurn: (game, choice, turn) => (states[turn] = structuredClone(game.serialize())) });
  for (const e of run.events) if (e.type === 'turn') e.state = states[e.turn];
  return run;
}
const shots = (run) => run.events.filter((e) => e.type === 'turn' && !e.boost && e.fired != null);
// Text for ffmpeg's drawtext goes through a file, which spares escaping it for the filter graph.
const textFile = (dir, name, text) => {
  const path = join(dir, `${name}.txt`);
  writeFileSync(path, text);
  return `textfile=${path}:expansion=none`;
};

// ---- The places a run visits, as chapters ----

// One stretch per visit to a place: { place, from, to (levels), frame }.
export function stretches(run) {
  const out = [];
  let level = run.events.find((e) => e.type === 'start').level || 1;
  let current = { place: run.events.find((e) => e.type === 'start').place, from: level, to: level, frame: 0 };
  for (const e of run.events) {
    if (e.type === 'level') {
      level = e.level;
      current.to = Math.max(current.to, level);
    } else if (e.type === 'place' && e.place !== current.place) {
      out.push(current);
      current = { place: e.place, from: level + (e.frame > 0 ? 1 : 0), to: level + 1, frame: e.frame };
    }
  }
  out.push(current);
  // A place changes under the veil before its first level begins; its first level is the next one.
  for (const s of out) s.to = Math.max(s.from, s.to);
  return out;
}

// YouTube's chapter rules: the first at 0:00, at least three, each at least 10 seconds long.
export function chapters(run) {
  const seen = new Set();
  const list = stretches(run).map((s, i) => {
    const again = seen.has(s.place);
    seen.add(s.place);
    const levels = s.from === s.to ? `level ${s.from}` : `levels ${s.from}–${s.to}`;
    return { at: i === 0 ? 0 : s.frame / run.fps, title: `${NAMES[s.place]}${again ? ' again' : ''} · ${levels}` };
  });
  const keep = [];
  for (const c of list) {
    if (keep.length && c.at - keep.at(-1).at < 10) keep[keep.length - 1] = { ...keep.at(-1), title: `${keep.at(-1).title}, ${c.title}` };
    else keep.push(c);
  }
  const end = run.seconds;
  while (keep.length > 1 && end - keep.at(-1).at < 10) keep.pop();
  return keep.length >= 3 ? keep : [];
}

// ---- YouTube: text and thumbnails ----

async function youtube(run) {
  const levels = run.level;
  const shotCount = shots(run).length;
  const big = shots(run).reduce((a, b) => (b.removed > a.removed ? b : a));
  const marks = chapters(run);
  const text = `TITLE (pick one)
Bubbler: one run to level ${levels}, ${fmt(run.score)} points (3D bubble shooter, no cuts)
${clock(run.seconds)} of glass bubbles: a full run of Bubbler, from level 1 to ${levels}
Bubbler: five night-time worlds, one run, no cuts

DESCRIPTION
One run of Bubbler, from the title screen to the last bubble: level ${levels}, ${fmt(run.score)} points in ${shotCount} shots. One take, no cuts. The biggest single shot cleared ${big.removed} bubbles.

Bubbler is a free, open-source 3D bubble shooter that runs in your browser, on phones and on PCs without a graphics card. No ads, no sign-up, nothing to install. Every three levels it moves on to a new place with its own music: Lantern Lake, Aurora Fjord, Firefly Marsh, Glow Lagoon and Neon Harbour.

Play: ${SITE_URL}
Source: ${REPO_URL}

This run is played by the game's own autoplay bot. It sees only what a player sees, and moves the mouse, aims and clicks the way a person does. It was recorded frame by frame in Chrome, so every frame is exactly as the game draws it.

${marks.length ? 'CHAPTERS\n' + marks.map((c) => `${clock(c.at)} ${c.title}`).join('\n') + '\n\n' : ''}HOW TO PLAY
- Aim and release. Three of a colour pop; anything left hanging falls into the water for double points.
- Tap the launcher (or right-click) to swap the two bubbles in hand.
- A ringed Comet clears its row when popped. A white Nova bursts when touched.
- Mist hides a bubble's colour until something pops beside it. Black Obsidian cannot be matched.
- Gems are never sold: the game hands them over when you are stuck.

TAGS
bubble shooter, bubble pop, puzzle game, browser game, web game, three.js, WebGL, open source game, free game, no ads, relaxing game, casual game, gameplay, full run
`;
  writeFileSync(join(run.dir, 'youtube.txt'), text);

  // Stills to choose a thumbnail from: the biggest clears, fly-over close-ups, and the title screen.
  const video = run.master;
  const picks = [];
  const top = [...shots(run)].sort((a, b) => b.removed - a.removed).slice(0, 2);
  // A big clear looks best as what it cut loose falls, about a second after the shot lands.
  const lands = (s) => (s.fired + Math.ceil(s.flight * run.fps)) / run.fps;
  for (const s of top) picks.push({ at: lands(s) + 1.05, why: `${s.removed} bubbles in ${NAMES[s.place]}` });
  const flights = run.events.filter((e) => e.type === 'flight');
  for (const f of flights.filter((_, i) => i % 3 === 0).slice(0, 5)) picks.push({ at: f.frame / run.fps + 3.2, why: `fly-over, level ${f.level}` });
  picks.push({ at: 1.2, why: 'title screen' });
  const lines = [];
  for (const [i, p] of picks.entries()) {
    const file = `thumb-${i + 1}.jpg`;
    await ffmpeg(['-ss', p.at.toFixed(3), '-i', video, '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '2', join(run.dir, file)]).done;
    lines.push(`${file}  ${clock(p.at)}  ${p.why}`);
  }
  writeFileSync(join(run.dir, 'thumbs.txt'), lines.join('\n') + '\n');
  console.log(`Wrote youtube.txt and ${picks.length} thumbnail stills in ${run.dir}`);
}

// ---- Joining pieces ----

// pieces: [{ video, audio?, start?, duration, vf?, hold? }]. `hold` freezes the last frame for that many
// seconds more. Video and sound crossfade from one to the next.
// `post` is applied to the joined picture (a crop, a band, text). Writes `out` with the sound at -14 LUFS.
async function join_(pieces, out, { post = '', fps = 60, crf = 17 } = {}) {
  const inputs = [];
  const filters = [];
  let n = 0;
  for (const [i, p] of pieces.entries()) {
    const seek = p.start != null ? ['-ss', p.start.toFixed(3), '-t', p.duration.toFixed(3)] : [];
    inputs.push(...seek, '-i', p.video);
    const v = n++;
    let a = v;
    if (p.audio) {
      inputs.push(...seek, '-i', p.audio);
      a = n++;
    }
    const hold = p.hold ? `,tpad=stop_mode=clone:stop_duration=${p.hold}` : '';
    const length = p.duration + (p.hold ?? 0);
    filters.push(`[${v}:v]${p.vf ? p.vf + ',' : ''}fps=${fps},settb=AVTB,setpts=PTS-STARTPTS${hold},trim=0:${length.toFixed(3)},format=yuv420p[v${i}]`);
    filters.push(`[${a}:a]aresample=48000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS,apad,atrim=0:${length.toFixed(3)}[a${i}]`);
  }
  let v = 'v0';
  let a = 'a0';
  const full = (p) => p.duration + (p.hold ?? 0);
  let length = full(pieces[0]);
  for (let i = 1; i < pieces.length; i++) {
    filters.push(`[${v}][v${i}]xfade=transition=fade:duration=${XFADE}:offset=${(length - XFADE).toFixed(3)}[vx${i}]`);
    filters.push(`[${a}][a${i}]acrossfade=d=${XFADE}[ax${i}]`);
    v = `vx${i}`;
    a = `ax${i}`;
    length += full(pieces[i]) - XFADE;
  }
  filters.push(`[${v}]${post ? post + ',' : ''}format=yuv420p,${TAG_709}[vout]`);
  const temp = out.replace(/\.mp4$/, '.tmp.mkv');
  await ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', `[${a}]`, ...X264(fps, crf), '-c:a', 'pcm_s16le', temp]).done;
  const audio = out.replace(/\.mp4$/, '.m4a');
  await encodeAudio(temp, audio, '320k');
  await ffmpeg(['-i', temp, '-i', audio, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', out]).done;
  rmSync(temp);
  rmSync(audio);
  return length;
}

// The best shot in each place, in the order the run reached them; a Comet or Nova blast wins a tie.
// A shot's place is the one its level belongs to, which is where a re-recorded piece is filmed.
function bestPerPlace(run, skip) {
  const out = [];
  for (const place of PLACES) {
    const here = shots(run).filter((s) => placeOf(s.level) === place && s !== skip && s.state);
    if (!here.length) continue;
    out.push(here.reduce((a, b) => (b.removed + (b.blasts.length ? 6 : 0) > a.removed + (a.blasts.length ? 6 : 0) ? b : a)));
  }
  return out.sort((a, b) => a.turn - b.turn);
}

// ---- The Short ----

async function short(run) {
  const dir = join(RECORDINGS, 'short');
  mkdirSync(dir, { recursive: true });
  const all = shots(run).filter((s) => s.state);
  const hook = all.reduce((a, b) => (b.removed > a.removed ? b : a));
  const places = bestPerPlace(run, hook);
  const turns = run.events.filter((e) => e.type === 'turn' && e.state);
  const last = turns.at(-1);
  // A fly-over close-up where the glass has the most to reflect.
  const flyPlace = ['harbour', 'fjord', 'lagoon'].find((p) => all.some((s) => placeOf(s.level) === p)) ?? 'lake';
  const flyLevel = Math.min(...all.filter((s) => placeOf(s.level) === flyPlace).map((s) => s.level));

  const plan = [
    { name: 'hook', shot: hook },
    { name: 'flyover', level: flyLevel, place: flyPlace },
    ...places.map((s) => ({ name: `best-${placeOf(s.level)}-${s.turn}`, shot: s })),
    // The last two shots and the game-over card, when the recording ran to the end.
    ...(run.events.some((e) => e.type === 'over') ? [{ name: 'end', shot: turns[Math.max(0, turns.length - 3)], toEnd: true }] : []),
  ];
  console.log(`Short: hook at turn ${hook.turn} (${hook.removed} bubbles), fly-over in ${NAMES[flyPlace]} (level ${flyLevel}), ${places.length} places, ending ${plan.at(-1).toEnd ? `from turn ${plan.at(-1).shot.turn} of ${last.turn}` : 'not recorded'}.`);
  const pieces = [];
  for (const [i, p] of plan.entries()) {
    process.stdout.write(`  recording ${p.name}... `);
    const piece = await recordPiece({
      name: 'short', file: `piece-${i + 1}-${p.name}.mp4`, seed: run.seed, profile: 'short', fps: run.fps,
      ...(p.shot ? { state: p.shot.state, turn: p.shot.turn, turns: 1, tail: 2.8, toEnd: !!p.toEnd } : { level: p.level, place: p.place }),
    }).catch((error) => {
      console.log(`failed: ${error.message}`);
      return null;
    });
    if (!piece) continue;
    const seconds = piece.frames / run.fps;
    console.log(`${seconds.toFixed(1)} s`);
    pieces.push({ video: piece.video, audio: piece.audio, duration: seconds });
  }
  // The game fills 1080x1440 between a title band above and a quiet band below, where Shorts lays
  // its own caption and buttons.
  const top = 170;
  const post = [
    `pad=1080:1920:0:${top}:color=0x060b1e`,
    `drawtext=fontfile=${FONT_LIGHT}:${textFile(dir, 'band-name', 'B U B B L E R')}:fontsize=64:fontcolor=white:x=(w-text_w)/2:y=40`,
    `drawtext=fontfile=${FONT}:${textFile(dir, 'band-link', 'Play free at ' + SITE)}:fontsize=32:fontcolor=0x9fe8ff:x=(w-text_w)/2:y=118`,
    `drawtext=fontfile=${FONT}:${textFile(dir, 'band-line', '3D bubble shooter · in your browser · no ads · open source')}:fontsize=28:fontcolor=0xb8c4e8:x=(w-text_w)/2:y=${top + 1440 + 34}`,
  ].join(',');
  const out = join(dir, 'bubbler-short.mp4');
  const length = await join_(pieces, out, { post, fps: run.fps });
  writeFileSync(join(dir, 'short.txt'), `TITLE\nLevel 1 to ${run.level} in one run #shorts\n\nDESCRIPTION\nBubbler, a free 3D bubble shooter in your browser. No ads, open source. Played by its own autoplay bot.\nPlay: ${SITE_URL}\n#bubbleshooter #puzzlegame #browsergame #indiegame\n`);
  console.log(`Wrote ${out} (${length.toFixed(1)} s)`);
}

// ---- X ----

async function x(run) {
  const dir = join(RECORDINGS, 'x');
  mkdirSync(dir, { recursive: true });
  const master = run.master;
  const sec = (frame) => frame / run.fps;
  const all = shots(run);
  const big = all.reduce((a, b) => (b.removed > a.removed ? b : a));
  const others = bestPerPlace(run, big).filter((s) => placeOf(s.level) !== placeOf(big.level)).slice(0, 3);
  const flights = run.events.filter((e) => e.type === 'flight');
  const firstFlight = flights[0];
  const change = run.events.find((e) => e.type === 'cleared' && run.events.some((p) => p.type === 'place' && p.frame > e.frame && p.frame - e.frame < run.fps * 3));
  const over = run.events.find((e) => e.type === 'over');
  const shotPiece = (s) => ({ start: sec(s.fired) - 1.1, duration: 3.9 });
  const cuts = [
    shotPiece(big),
    { start: sec(firstFlight.frame) + 1.5, duration: 4.2 },
    ...others.map(shotPiece),
    ...(change ? [{ start: sec(change.frame) - 0.4, duration: 6.4 }] : []),
    ...(over ? [{ start: sec(over.frame) - 0.6, duration: 3.6 }] : []),
    // The title screen, with the link: a still moment before the hand reaches for Play, held.
    { start: 0.65, duration: 0.75, hold: 1.9 },
  ];
  // A square from the middle of the 16:9 frame: the whole board and its HUD, with scenery either side.
  const pieces = cuts.map((c) => ({ video: master, ...c, vf: 'crop=ih:ih,scale=1080:1080:flags=lanczos' }));
  const total = pieces.reduce((s, p) => s + p.duration + (p.hold ?? 0), 0) - XFADE * (pieces.length - 1);
  const endAt = total - cuts.at(-1).duration - cuts.at(-1).hold;
  const post = `drawtext=fontfile=${FONT}:${textFile(dir, 'end-link', 'Play free at ' + SITE)}:fontsize=40:fontcolor=white:shadowcolor=black@0.7:shadowx=0:shadowy=2:x=(w-text_w)/2:y=h-170:enable='gte(t,${(endAt + 0.2).toFixed(2)})'`;
  const out = join(dir, 'bubbler-x.mp4');
  const length = await join_(pieces, out, { post, fps: run.fps, crf: 18 });
  writeFileSync(join(dir, 'x.txt'), `One run of Bubbler, level 1 to ${run.level}, ${fmt(run.score)} points. A free 3D bubble shooter that runs in your browser: no ads, open source. Played by the game's own autoplay bot, in one take.\n\nPlay: ${SITE_URL}\nCode: ${REPO_URL}\n`);
  console.log(`Wrote ${out} (${length.toFixed(1)} s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  const i = process.argv.indexOf('--run');
  const run = loadRun(i < 0 ? join(RECORDINGS, 'youtube') : process.argv[i + 1]);
  if (mode === 'youtube') await youtube(run);
  else if (mode === 'short') await short(run);
  else if (mode === 'x') await x(run);
  else {
    console.log('Usage: node tools/cut.js youtube|short|x [--run recordings/youtube]');
    process.exit(1);
  }
}

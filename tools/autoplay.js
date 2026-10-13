// Finds the run to record: plays many seeds with the expert bot in Node and ranks them by how far they
// get. Choosing the seed is choosing which attempt to publish, as a player would show their best run;
// within a run the bot plays fair (see expertPolicy). The same run then plays out shot for shot in the
// browser, because the rules are deterministic and the recorder asks the same bot.
// Usage: node tools/autoplay.js [--seeds 400] [--from 1] [--top 10]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Game } from '../src/core/game.js';
import { SHOT_SPEED, LEVELS_PER_PLACE, placeOf } from '../src/config.js';
import { expertPolicy, takeTurn } from './sim-bot.js';

// Plays one run to the end, taking every Second Wind on offer. onTurn(game, choice, turn) sees each
// decision before it is carried out. Returns the run's numbers and a rough video length.
export function playRun(seed, { onTurn } = {}) {
  const game = new Game({ seed });
  const out = { seed, shots: 0, swaps: 0, boosts: 0, caught: 0, revives: 0, flight: 0, big: [] };
  let turn = 0;
  while (game.phase !== 'over' && game.stats.shots < 5000) {
    if (game.phase === 'cleared') game.nextLevel();
    else if (game.phase === 'nomoves') {
      if (game.revive()) out.revives++;
      else game.endRun();
    } else {
      const choice = expertPolicy(game);
      onTurn?.(game, choice, turn++);
      const score = game.score;
      const res = takeTurn(game, choice);
      if (!res) {
        out.boosts++;
        continue;
      }
      out.shots++;
      if (choice.swap) out.swaps++;
      out.caught += res.caught.length;
      out.flight += res.fly.len / SHOT_SPEED;
      if (res.popped + res.dropped >= 25) out.big.push({ level: game.level, removed: res.popped + res.dropped, points: game.score - score });
    }
  }
  Object.assign(out, { level: game.level, score: game.score, best: game.stats.best, reason: game.overReason, turns: turn });
  out.places = [...new Set(Array.from({ length: game.level }, (_, i) => placeOf(i + 1)))];
  out.seconds = estimateSeconds(out);
  return out;
}

// About how long the run lasts on screen. Measured on a 36-minute recording: besides its flight, a
// shot takes 2.3 s (a look, a move, a press, and the pops and drops settling); besides its fly-over
// (the full tour when the place changes, a short one otherwise), a new level takes 4.1 s.
export function estimateSeconds(run) {
  const levels = run.level;
  const full = Math.ceil(levels / LEVELS_PER_PLACE);
  return 3 + run.shots * 2.32 + run.flight + run.swaps * 0.45 + run.boosts * 0.9 + run.caught * 0.9
    + (levels - 1) * 4.1 + full * 6.6 + (levels - full) * 3.2 + run.revives * 2.5 + 7;
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

if (!isMainThread && workerData?.autoplay) {
  for (const seed of workerData.seeds) {
    const { big, ...run } = playRun(seed);
    parentPort.postMessage({ ...run, big: big.length });
  }
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf('--' + name);
    return i < 0 ? fallback : Number(process.argv[i + 1]);
  };
  const SEEDS = arg('seeds', 400);
  const FROM = arg('from', 1);
  const TOP = arg('top', 10);
  const threads = Math.min(availableParallelism(), SEEDS);
  const t0 = performance.now();
  const runs = [];
  await Promise.all(Array.from({ length: threads }, (_, w) => new Promise((resolve, reject) => {
    const seeds = [];
    for (let s = FROM + w; s < FROM + SEEDS; s += threads) seeds.push(s);
    const worker = new Worker(new URL(import.meta.url), { workerData: { autoplay: true, seeds } });
    worker.on('message', (run) => {
      runs.push(run);
      if (runs.length % 25 === 0) process.stdout.write(`\r${runs.length}/${SEEDS} runs`);
    });
    worker.on('error', reject);
    worker.on('exit', resolve);
  })));
  process.stdout.write('\r');
  runs.sort((a, b) => b.level - a.level || b.score - a.score);
  const levels = runs.map((r) => r.level).sort((a, b) => a - b);
  console.log(`${SEEDS} runs in ${((performance.now() - t0) / 1000).toFixed(0)} s. Level reached: median ${levels[levels.length >> 1]}, best ${levels.at(-1)}.`);
  console.log('\n seed  level    score  shots  revives  boosts  big shots  video');
  for (const r of runs.slice(0, TOP)) {
    console.log(
      String(r.seed).padStart(5), String(r.level).padStart(6), r.score.toLocaleString('en-US').padStart(8), String(r.shots).padStart(6),
      String(r.revives).padStart(8), String(r.boosts).padStart(7), String(r.big).padStart(10), clock(r.seconds).padStart(6),
    );
  }
  console.log(`\nRecord one with: npm run record -- youtube --seed ${runs[0].seed}`);
}

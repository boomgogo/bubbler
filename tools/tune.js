// Plays whole runs with the headless players and prints how the game pays out.
//   node tools/tune.js [--games 40] [--revive]
import { Game } from '../src/core/game.js';
import { createRng } from '../src/core/rng.js';
import { randomPolicy, greedyPolicy, casualPolicy } from './sim-bot.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? fallback : (process.argv[i + 1] ?? true);
};
const GAMES = Number(arg('games', 40));
const REVIVE = process.argv.includes('--revive');

const BUCKETS = ['Nothing', '1 to 5', '6 to 15', '16 to 40', 'More than 40'];
const bucket = (n) => (n === 0 ? 0 : n <= 5 ? 1 : n <= 15 ? 2 : n <= 40 ? 3 : 4);
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

function play(policy, seed) {
  const game = new Game({ seed });
  const rng = createRng(seed ^ 0x5bd1e995);
  const out = { buckets: [0, 0, 0, 0, 0], levels: {}, specials: 0, gifts: 0 };
  let levelShots = 0;
  const startLevel = () => {
    out.levels[game.level] = { rows: game.levelRows, movesAtStart: game.moves, shots: null };
    levelShots = 0;
  };
  startLevel();
  while (game.phase !== 'over' && game.stats.shots < 5000) {
    if (game.phase === 'cleared') {
      out.levels[game.level].shots = levelShots;
      game.nextLevel();
      startLevel();
    } else if (game.phase === 'nomoves') {
      if (!(REVIVE && game.revive())) game.endRun();
    } else {
      const choice = policy(game, rng);
      if (choice.swap) game.swap();
      const res = game.fire(choice.angle);
      out.buckets[bucket(res.popped + res.dropped)]++;
      if (res.special) out.specials++;
      out.gifts += res.gifts.reduce((s, g) => s + g.amount, 0);
      levelShots++;
    }
  }
  return Object.assign(out, { level: game.level, score: game.score, shots: game.stats.shots, best: game.stats.best, reason: game.overReason });
}

for (const [name, policy] of [['random', randomPolicy], ['casual', casualPolicy], ['greedy', (game) => greedyPolicy(game)]]) {
  const t0 = performance.now();
  const runs = [];
  for (let g = 0; g < GAMES; g++) runs.push(play(policy, 1000 + g));
  const total = [0, 0, 0, 0, 0];
  for (const r of runs) r.buckets.forEach((n, i) => (total[i] += n));
  const shots = total.reduce((s, x) => s + x, 0);

  console.log(`\n=== ${name}: ${GAMES} runs${REVIVE ? ', Second Wind used' : ''} (${((performance.now() - t0) / 1000).toFixed(1)} s) ===`);
  console.log('One shot removes');
  BUCKETS.forEach((label, i) => console.log(' ', label.padEnd(16), ((100 * total[i]) / shots).toFixed(1).padStart(5) + '%'));
  const ends = {};
  for (const r of runs) ends[r.reason] = (ends[r.reason] ?? 0) + 1;
  console.log(
    `level reached: mean ${mean(runs.map((r) => r.level)).toFixed(1)}, median ${median(runs.map((r) => r.level))}, max ${Math.max(...runs.map((r) => r.level))}`,
    `| shots/run ${mean(runs.map((r) => r.shots)).toFixed(0)} | score mean ${Math.round(mean(runs.map((r) => r.score))).toLocaleString()}`,
    `| biggest shot ${Math.max(...runs.map((r) => r.best))} | special shots ${((100 * runs.reduce((s, r) => s + r.specials, 0)) / shots).toFixed(1)}%`,
    `| gems gifted/run ${mean(runs.map((r) => r.gifts)).toFixed(1)} | ended`, JSON.stringify(ends),
  );
  if (name !== 'random') {
    console.log('level  runs  rows  shots to clear  moves at start');
    const maxLevel = Math.max(...runs.map((r) => r.level));
    for (let L = 1; L <= maxLevel; L++) {
      const at = runs.map((r) => r.levels[L]).filter(Boolean);
      if (at.length < 3) break;
      const cleared = at.filter((l) => l.shots != null);
      console.log(
        String(L).padStart(5), String(at.length).padStart(5), String(median(at.map((l) => l.rows))).padStart(5),
        String(median(cleared.map((l) => l.shots))).padStart(10), String(median(at.map((l) => l.movesAtStart))).padStart(16),
      );
    }
  }
}

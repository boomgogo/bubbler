// Racing friends: the standings every page builds from the room's log, and the watcher's replay
// of another player's run. The browser side, against a real p3p2 server, is tools/check-mp.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Standings, table, raceOp } from '../../src/net/standings.js';
import { Game } from '../../src/core/game.js';
import { greedyPolicy } from '../sim-bot.js';

// A room's log as every page reads it: the same ops, in one order, each with its sender.
const pages = (n) => Array.from({ length: n }, () => new Standings());
const feed = (all, log) => {
  for (const s of all) for (const [op, pid] of log) s.apply(JSON.parse(JSON.stringify(op)), pid);
};
const score = (race, name, sc, st = 'playing', lv = 1) => ({ t: 'score', race, name, lv, sc, shots: 3, st });

test('race: two pages that start the first race at once get one race, the same on both', () => {
  const [a, b] = pages(2);
  const first = raceOp(null);
  const second = raceOp(null);
  feed([a, b], [[first, 'pa'], [second, 'pb']]);
  assert.equal(a.current.id, first.id);
  assert.equal(b.current.id, first.id);
  assert.equal(a.races.length, 1);
  assert.equal(a.current.seed, first.seed);
});

test('race: two Rematch presses at once give one new race', () => {
  const [a] = pages(1);
  const first = raceOp(null);
  feed([a], [[first, 'pa']]);
  const one = raceOp(first.id);
  const two = raceOp(first.id);
  feed([a], [[one, 'pa'], [two, 'pb']]);
  assert.equal(a.current.id, one.id);
  assert.equal(a.current.n, 2);
  assert.equal(a.races.length, 2);
  // A third race names the second, and the oldest beyond three is forgotten.
  let after = one.id;
  for (let i = 0; i < 3; i++) {
    const op = raceOp(after);
    feed([a], [[op, 'pa']]);
    after = op.id;
  }
  assert.equal(a.races.length, 3);
  assert.equal(a.current.n, 5);
});

test('race: a player who joins late sees the standing of one who already left', () => {
  const r = raceOp(null);
  const log = [[r, 'ada'], [score(r.id, 'Ada', 0), 'ada'], [score(r.id, 'Bo', 0), 'bo'], [score(r.id, 'Bo', 240, 'left', 3), 'bo'], [score(r.id, 'Ada', 410, 'playing', 4), 'ada']];
  const [early] = pages(1);
  feed([early], log);
  // Dee arrives after Bo has gone: she is handed the whole log.
  const [late] = pages(1);
  feed([late], log);
  const race = late.race(r.id);
  assert.deepEqual(race.rows.get('bo'), { name: 'Bo', lv: 3, sc: 240, shots: 3, st: 'left' });
  // Ada is here (live presence), Bo is not.
  const rows = table(race, new Map([['ada', { r: r.id, lv: 5, sc: 900, st: 'aim', name: 'Ada', state: 'here', id: 1 }]]));
  assert.deepEqual(rows.map((x) => [x.name, x.sc, x.here]), [['Ada', 900, true], ['Bo', 240, false]]);
  assert.deepEqual(early.save(), late.save());
});

test('race: a snapshot carries on as the ops did', () => {
  const r = raceOp(null);
  const before = [[r, 'ada'], [score(r.id, 'Ada', 50), 'ada'], [score(r.id, 'Bo', 20), 'bo']];
  const later = [[score(r.id, 'Bo', 90, 'over', 2), 'bo'], [raceOp(r.id), 'bo']];
  const [all] = pages(1);
  feed([all], [...before, ...later]);
  const [host] = pages(1);
  feed([host], before);
  const [joiner] = pages(1);
  joiner.load(JSON.parse(JSON.stringify(host.save())));
  feed([joiner], later);
  assert.deepEqual(joiner.save(), all.save());
});

test('race: ops that are not what this game sends are ignored', () => {
  const [a] = pages(1);
  const r = raceOp(null);
  feed([a], [[r, 'ada']]);
  const bad = [
    null, 'race', { t: 'race', id: 'x', seed: 1, after: r.id }, { t: 'race', id: 'abcdef', seed: -1, after: r.id },
    { t: 'race', id: 'abcdef', seed: 2 ** 32, after: r.id }, { t: 'race', id: 'abcdef', seed: 1, after: 'nope00' },
    { t: 'score', race: 'nope00', name: 'X', lv: 1, sc: 1, shots: 1, st: 'playing' },
    { t: 'score', race: r.id, name: 'X', lv: 1, sc: Infinity, shots: 1, st: 'playing' },
    { t: 'score', race: r.id, name: 'X', lv: 1, sc: 1, shots: 1, st: 'winning' },
    { t: 'score', race: r.id, name: 7, lv: 1, sc: 1, shots: 1, st: 'playing' },
  ];
  for (const op of bad) assert.equal(a.apply(op, 'eve'), false, JSON.stringify(op));
  assert.equal(a.races.length, 1);
  assert.equal(a.current.rows.size, 0);
  assert.ok(raceOp(null).id.length >= 6);
});

test('race: equal scores, then levels, set the order; other races stay out', () => {
  const r = raceOp(null);
  const [a] = pages(1);
  feed([a], [[r, 'x'], [score(r.id, 'Cy', 100, 'playing', 2), 'cy'], [score(r.id, 'Bo', 100, 'over', 3), 'bo'], [score(r.id, 'Al', 30), 'al']]);
  const live = new Map([['zed', { r: 'other0', lv: 9, sc: 999, st: 'aim', name: 'Zed' }]]);
  assert.deepEqual(table(a.current, live).map((x) => x.name), ['Bo', 'Cy', 'Al']);
});

// The watcher's replay. A watched page sends each change with its state after it; the watcher
// makes the same change on its copy and checks the two match. In one engine they always must.
test('race: a watcher replaying another run step by step holds the same state, over 500 shots', () => {
  let steps = 0;
  for (const seed of [3, 41, 177, 2026]) {
    const sender = new Game({ seed });
    let copy = Game.load(JSON.parse(JSON.stringify(sender.serialize())));
    const step = (ev, act) => {
      act(sender);
      act(copy);
      const sent = JSON.stringify(JSON.parse(JSON.stringify(sender.serialize()))); // as the message carries it
      assert.equal(JSON.stringify(copy.serialize()), sent, `seed ${seed}, step ${steps} (${ev})`);
      steps++;
    };
    for (let i = 0; i < 200 && sender.phase !== 'over'; i++) {
      if (sender.phase === 'cleared') step('level', (g) => g.nextLevel());
      else if (sender.phase === 'nomoves') step(sender.gems >= sender.reviveCost ? 'revive' : 'end', (g) => g.revive() || g.endRun());
      else if (i % 23 === 7 && sender.gems >= 3) step('comet', (g) => g.buyComet());
      else if (i % 29 === 11 && sender.hasMist()) step('clear', (g) => g.buyClear());
      else {
        const pick = greedyPolicy(sender, 40);
        if (pick.swap) step('swap', (g) => g.swap());
        step('shot', (g) => g.fire(pick.angle));
      }
      // Now and then the watcher starts afresh from what was sent, as one that joins late does.
      if (i % 50 === 49) copy = Game.load(JSON.parse(JSON.stringify(sender.serialize())), { finished: true });
    }
  }
  assert.ok(steps >= 500, `${steps} steps`);
});

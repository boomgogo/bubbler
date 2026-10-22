// The races of a room and how everyone stands in them, built from the room's log. Every page is
// handed the same ops in the same order, so every page holds the same standings, a player who
// joined late included. No DOM and no p3p2 in here, so it runs in Node for tests.

const KEEP = 3; // races remembered: the current one and the two before it
const STATES = new Set(['playing', 'over', 'left']);
const isId = (id) => typeof id === 'string' && /^[0-9a-z]{4,16}$/.test(id);
const isCount = (n) => Number.isFinite(n) && n >= 0;

// The op that starts a race after the race `after` (null for a room's first). Two pages that start
// one at the same moment both name the same `after`, so only the first to reach the log counts.
export function raceOp(after) {
  const [a, b, seed] = crypto.getRandomValues(new Uint32Array(3));
  return { t: 'race', id: (a.toString(36) + b.toString(36)).slice(0, 12).padEnd(6, '0'), seed, after };
}

export class Standings {
  constructor() {
    this.races = []; // oldest first: { id, seed, by, n, rows: Map pid -> standing }
  }

  get current() {
    return this.races.at(-1) ?? null;
  }

  race(id) {
    return this.races.find((r) => r.id === id) ?? null;
  }

  // One op of the log, sent by the player `pid`. Returns whether anything changed. Ops come from
  // other people's pages, so anything malformed is ignored.
  apply(op, pid) {
    if (!op || typeof op !== 'object' || typeof pid !== 'string') return false;
    if (op.t === 'race') {
      if (!isId(op.id) || !Number.isInteger(op.seed) || op.seed < 0 || op.seed > 0xffffffff) return false;
      if ((op.after ?? null) !== (this.current?.id ?? null) || this.race(op.id)) return false;
      this.races.push({ id: op.id, seed: op.seed, by: pid, n: (this.current?.n ?? 0) + 1, rows: new Map() });
      if (this.races.length > KEEP) this.races.shift();
      return true;
    }
    if (op.t === 'score') {
      const race = this.race(op.race);
      if (!race || typeof op.name !== 'string' || !STATES.has(op.st)) return false;
      if (![op.lv, op.sc, op.shots].every(isCount)) return false;
      race.rows.set(pid, { name: op.name.slice(0, 40), lv: op.lv, sc: op.sc, shots: op.shots, st: op.st });
      return true;
    }
    return false;
  }

  // For the room's snapshot, which whoever joins later starts from.
  save() {
    return { races: this.races.map((r) => ({ ...r, rows: [...r.rows] })) };
  }

  load(state) {
    this.races = [];
    for (const r of state?.races ?? []) {
      if (!isId(r?.id) || !Number.isInteger(r.seed) || !Array.isArray(r.rows)) continue;
      this.races.push({ id: r.id, seed: r.seed, by: String(r.by), n: Number(r.n) || 1, rows: new Map(r.rows) });
    }
  }
}

// One row per player in `race`: what the log says, overlaid with `live` (pid -> the latest presence
// of a player still in the room). Best score first, then the highest level.
export function table(race, live) {
  const rows = new Map();
  for (const [pid, s] of race.rows) rows.set(pid, { pid, ...s, here: false });
  for (const [pid, p] of live) {
    if (p.r !== race.id) continue;
    rows.set(pid, { pid, name: p.name, lv: p.lv, sc: p.sc, shots: rows.get(pid)?.shots ?? 0, st: p.st, w: p.w, state: p.state, id: p.id, here: true });
  }
  return [...rows.values()].sort((a, b) => b.sc - a.sc || b.lv - a.lv || a.name.localeCompare(b.name));
}

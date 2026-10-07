import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACES } from '../../src/config.js';
import { loadPlace } from '../../src/render/places/index.js';

const ids = [...new Set(PLACES)];
const shared = () => ({ time: { value: 0 }, glow: { value: 1 }, pointScale: { value: 1 } });

// Plays `bars` bars of a score into a stand-in for the band and returns every note booked.
// Times start far above any midi number, so a voice's first argument tells notes from times.
function listen(music, bars = 64) {
  const beat = 60 / music.bpm;
  const bar = beat * (music.beats ?? 4);
  const T0 = 1000.25;
  const events = [];
  const play = new Proxy({ beat, bar, hz: (n) => 440 * 2 ** ((n - 69) / 12) }, {
    get(target, name) {
      if (name in target) return target[name];
      return (first, second) => {
        const notes = Array.isArray(first) ? first : Number.isInteger(first) && first < 128 ? [first] : [];
        events.push({ voice: name, notes, at: notes.length ? second : first });
      };
    },
  });
  for (let i = 0; i < bars; i++) music.bar(play, i, T0 + i * bar);
  return { events, minutes: (bars * bar) / 60, barAt: (at) => Math.floor((at - T0) / bar) };
}

// The pops play D major pentatonic (D E F# A B) over the music, so a score has to stay inside
// a key that holds all five: D, G or A major (or their relative minors).
const KEYS = {
  'D major': [2, 4, 6, 7, 9, 11, 1],
  'G major': [7, 9, 11, 0, 2, 4, 6],
  'A major': [9, 11, 1, 2, 4, 6, 8],
};

for (const id of ids) {
  test(`place ${id}: loads, is named, and keeps to the draw-call budget`, async () => {
    const place = await loadPlace(id);
    assert.equal(place.id, id);
    assert.ok(place.name.length > 0);
    assert.match(place.theme, /^#[0-9a-f]{6}$/);
    const group = place.build(shared());
    let draws = 0;
    group.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isLine) draws++;
    });
    assert.ok(draws > 0 && draws <= 8, `${draws} draw calls; the kit's rule 6 allows 8`);
  });

  test(`place ${id}: the music is in tune with the pops`, async () => {
    const { music } = await loadPlace(id);
    const classes = new Set();
    for (const e of listen(music).events) for (const n of e.notes) classes.add(((n % 12) + 12) % 12);
    const key = Object.entries(KEYS).find(([, scale]) => [...classes].every((c) => scale.includes(c)));
    assert.ok(key, `pitch classes ${[...classes].sort((a, b) => a - b)} fit none of ${Object.keys(KEYS).join(', ')}`);
  });

  // Not a drone: some voice besides the pad and the bass carries a line (at least 16 notes over
  // six or more pitches within eight bars), and notes keep coming.
  test(`place ${id}: the music has a tune and a beat`, async () => {
    const { music } = await loadPlace(id);
    const { events, minutes, barAt } = listen(music);
    const lines = new Map();
    for (const e of events) {
      if (e.voice === 'pad' || e.voice === 'bass' || e.notes.length !== 1) continue;
      const key = `${e.voice} ${Math.floor(barAt(e.at) / 8)}`;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push(e.notes[0]);
    }
    const tune = [...lines.values()].some((notes) => notes.length >= 16 && new Set(notes).size >= 6);
    assert.ok(tune, 'no voice carries a line');
    assert.ok(events.length / minutes >= 40, `${(events.length / minutes).toFixed(0)} notes a minute`);
  });
}

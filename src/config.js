// Rules, level and economy tunables. Nothing in here touches the DOM or three.js,
// so the same numbers drive the game, the tests and the tuning bot.

// The HUD's CSS in index.html places things in these same units, so its positions
// have to be moved by hand when COLS or LAUNCH_Y change.
export const COLS = 10; // cells in an even row; odd rows hold one fewer and sit half a cell right
export const ROW_H = Math.sqrt(3) / 2; // row pitch, in bubble diameters
export const VISIBLE_ROWS = 8; // rows of a level on screen when it starts
export const FAIL_ROW = 13; // a bubble this many rows below the top of the view ends the run
export const LAUNCH_Y = 13.5; // launcher centre, measured down from the top of the view

export const CONTACT = 0.86; // centre distance at which a shot sticks; below 1 so near-misses slip through
export const AIM_MIN = 0.21; // shallowest aim, radians above horizontal
export const SHOT_SPEED = 34; // bubble diameters per second
export const TICK_MS = 45; // one step of a pop ripple

export const KIND = { COLOR: 0, COMET: 1, NOVA: 2, OBSIDIAN: 3 };
export const PALETTE_SIZE = 5;

export const START_MOVES = 30;
export const MOVES_PER_LEVEL = 15;
export const POINTS_POP = 1;
export const POINTS_DROP = 2;
export const STREAK_STEP = 0.1; // each scoring shot in a row adds this much to the next one
export const STREAK_CAP = 10;

export const NOVA_RADIUS = 2; // cells
export const PIERCE_LEN = 6; // how far a Comet shot ploughs on after first contact
export const PIERCE_R = 0.62;
export const DROUGHT = 5; // a colour on the board is dealt at least this often

export const GEMS = {
  start: 3,
  comet: 3,
  clear: 2,
  reviveBase: 3,
  reviveStep: 2,
  reviveMoves: 8,
  dryShots: 4, // shots in a row that remove nothing
  dryCooldown: 10,
  dryGift: 1,
  lowMoves: 6,
  lowMovesGift: 2,
  crowdRows: 3, // this close to the fail row counts as crowded
  crowdGift: 1,
};

// Where each level is played. The places change every few levels and start over after the last.
export const LEVELS_PER_PLACE = 3;
export const PLACES = ['lake', 'fjord', 'marsh', 'lagoon', 'harbour'];
export const placeOf = (level) => PLACES[Math.floor((Math.max(1, level) - 1) / LEVELS_PER_PLACE) % PLACES.length];

// What a level is made of. `rows` is the middle of the range; the generator varies it.
// Level 2 introduces Mist; level 3 introduces Obsidian together with the Nova that breaks it.
export function levelParams(level) {
  const L = level;
  return {
    rows: L <= 3 ? 8 : Math.round(1.7 * L + 1.5),
    rowSpread: L <= 3 ? 0 : 1,
    colors: L === 1 ? 3 : 4,
    // Mean size of a same-colour patch. Big patches are ready-made matches.
    patch: Math.max(2.3, 5.2 - 0.3 * (L - 1)),
    empty: L === 1 ? 0 : L === 2 ? 0.05 : L === 3 ? 0.09 : 0.12,
    mist: L < 2 || L === 3 ? 0 : L === 2 ? 0.25 : Math.min(0.28, 0.17 + 0.012 * (L - 4)),
    obsidian: L < 3 ? 0 : L === 3 ? 0.07 : 0.045,
    comets: 0.018, // on top of the one that always sits in the top row
    novas: L < 3 ? 0 : L === 3 ? 0.03 : 0.013,
  };
}

// Official (and reference) layout presets for the gallery.
//
// Correction 1 (Task 15): this builder used to live in test/fixtures.js.
// Source must not import from test/, so the construction moved here and
// test/fixtures.js now re-exports it — one definition, tests unchanged.
//
// Correction 2 (Task 15): the manual figures in docs/ are too
// low-resolution to transcribe their grids reliably. Shipping a guessed
// layout would silently teach the bill of materials the wrong thing, which
// is worse than shipping fewer presets. So this file ships only the
// hand-derived reference ring used throughout the test suite — nothing
// from the manuals. Task 16 adds the stock L separately.

// Outer 7x9, hole 3x5, corridor 2 mats wide, 48 mats.
// Corner rotations: rot 0 exits N and E, so each corner is rotated to face
// the two neighbours it must meet.
export function rectangularRing() {
  const pieces = [
    { type: 'cornerR30', x: 0, y: 0, rot: 90 },   // top-left,  ports E + S
    { type: 'cornerR30', x: 5, y: 0, rot: 180 },  // top-right, ports S + W
    { type: 'cornerR30', x: 5, y: 7, rot: 270 },  // bot-right, ports W + N
    { type: 'cornerR30', x: 0, y: 7, rot: 0 },    // bot-left,  ports N + E
  ];
  for (const x of [2, 3, 4]) {
    pieces.push({ type: 'straight', x, y: 0, rot: 90 });
    pieces.push({ type: 'straight', x, y: 7, rot: 90 });
  }
  for (const y of [2, 3, 4, 5, 6]) {
    pieces.push({ type: 'straight', x: 0, y, rot: 0 });
    pieces.push({ type: 'straight', x: 5, y, rot: 0 });
  }
  return pieces;
}

export const PRESETS = [
  {
    id: 'ring-7x9',
    name: '7×9 Rectangular Ring',
    // Not an official Kyosho plan — this is the hand-derived reference
    // layout used throughout the test suite. Labelled honestly so nobody
    // later mistakes it for something Kyosho published.
    source: 'derived reference layout',
    pieces: rectangularRing(),
  },
];

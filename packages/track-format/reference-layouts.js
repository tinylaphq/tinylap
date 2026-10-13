// Reference layouts: hand-derived, verified against the model, and shared by
// every app's tests. stockL is the layout printed in the 87033 manual.

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

// Task 16: the 87033 manual shows an L-shaped layout labelled 2.1 m x 2.7 m
// (a 7x9 mat bounding box). An earlier analysis in spec 13.2 concluded the
// published figures (48 mats, 7x9 bounding box, 6 quarter-rounds) could not
// all hold in one 2-mat-wide L ring at once — that conclusion was wrong; a
// corrected erosion argument in spec 13.2 shows a construction exists that
// hits all of them exactly, and this preset (and test/stock-l.test.js) is
// that construction, verified against the model code. Built from the
// constraints that ARE certain: a 7x9 outer box with a corner notch cut out
// to make an L, eroded inward by 2 mats (the track width) to leave the
// infield hole.
//
// The notch has to be at least 2x2 for the reflex corner it creates to be
// a genuine corner rather than a 1-cell nick (see spec 13.2's "a, b >= 2"
// reasoning) — and 2x2 is also the notch that maximises the mat count, so
// that's what's used here. Cutting it from the top-right is an arbitrary
// choice; any corner gives the same piece counts, just mirrored/rotated.
//
// An L ring needs six R30 corners, not four: five convex ones on the
// outer boundary, plus a sixth where the infield hole's own corner rounds
// off right next to the notch (the "elbow"). That sixth corner is what
// supplies the extra quarter-round mat, curve barrier and corner cap the
// 87033 box ships beyond a plain rectangular ring's four.
export function stockL() {
  const pieces = [
    { type: 'cornerR30', x: 0, y: 0, rot: 90 },   // outer top-left,     ports E + S
    { type: 'cornerR30', x: 3, y: 0, rot: 180 },  // outer top-right,    ports S + W
    { type: 'cornerR30', x: 5, y: 2, rot: 180 },  // outer notch corner, ports S + W
    { type: 'cornerR30', x: 5, y: 7, rot: 270 },  // outer bottom-right, ports W + N
    { type: 'cornerR30', x: 0, y: 7, rot: 0 },    // outer bottom-left,  ports N + E
    { type: 'cornerR30', x: 3, y: 2, rot: 0 },    // infield elbow,      ports N + E
  ];
  pieces.push({ type: 'straight', x: 2, y: 0, rot: 90 }); // stub joining the two top corners
  for (const y of [2, 3, 4, 5, 6]) pieces.push({ type: 'straight', x: 0, y, rot: 0 });
  for (const y of [4, 5, 6]) pieces.push({ type: 'straight', x: 5, y, rot: 0 });
  for (const x of [2, 3, 4]) pieces.push({ type: 'straight', x, y: 7, rot: 90 });
  return pieces;
}

// Four R30 corners packed into a 4x4 block. rot 0 exits N and E, so each
// corner is turned to face the two neighbours it must meet.
export function fourCornerLoop() {
  return [
    { type: 'cornerR30', x: 0, y: 0, rot: 90 },   // top-left,  ports E + S
    { type: 'cornerR30', x: 2, y: 0, rot: 180 },  // top-right, ports S + W
    { type: 'cornerR30', x: 2, y: 2, rot: 270 },  // bot-right, ports W + N
    { type: 'cornerR30', x: 0, y: 2, rot: 0 },    // bot-left,  ports N + E
  ];
}

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

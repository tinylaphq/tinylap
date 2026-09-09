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

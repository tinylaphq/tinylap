// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The track-record bell (records spec §4.3): a struck bell from a few sine
// partials, each decaying on its own. No file; ring() needs an AudioContext
// that a click has started.

/** [frequency in Hz, level, decay in seconds] */
export const PARTIALS = [[880, 0.25, 1.6], [1760, 0.12, 1.1], [2430, 0.08, 0.7], [4750, 0.04, 0.4]];

/** Strikes the bell now. @param {AudioContext} context */
export function ring(context) {
  if (context.state === 'suspended') context.resume().catch(() => {});
  const start = context.currentTime;
  for (const [hz, level, decay] of PARTIALS) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + decay);
  }
}

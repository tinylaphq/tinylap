// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// Passings of one transponder become laps (spec §3). A lap is the difference
// of two decoder times from the same boot, so network delay never changes it.

/** @import { LapStep, Mark } from './types.js' */

export const MIN_LAP_MS = 1500;
export const MAX_LAP_MS = 60_000;

/**
 * What `mark` means, given the passing laps are measured from (null at
 * first sight of the transponder).
 * @param {Mark | null} reference @param {Mark} mark
 * @param {{ minLap?: number, maxLap?: number }} [options]
 * @returns {LapStep}
 */
export function nextLap(reference, mark, { minLap = MIN_LAP_MS, maxLap = MAX_LAP_MS } = {}) {
  if (!reference || reference.boot !== mark.boot) return { kind: 'start', reference: mark };
  const ms = mark.t - reference.t;
  if (ms <= 0) return { kind: 'backwards', reference };
  if (ms < minLap) return { kind: 'double', reference };
  if (ms > maxLap) return { kind: 'start', reference: mark };
  return { kind: 'lap', ms, reference: mark };
}

/** Every step of a sequence of marks, in order. @param {Mark[]} marks @param {{ minLap?: number, maxLap?: number }} [options] */
export function lapsOf(marks, options) {
  /** @type {Mark | null} */
  let reference = null;
  return marks.map((mark) => {
    const step = nextLap(reference, mark, options);
    reference = step.reference;
    return step;
  });
}

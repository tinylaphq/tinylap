// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Turning generated layouts into the list the dialog shows: which shapes
// are on offer, which of them the user asked for, and in what order.
//
// Separate from js/app.js because this is the only part of the
// suggestions UI that is real logic rather than DOM wiring, and app.js is
// almost entirely untestable for being DOM-bound. Everything here is pure:
// it takes scored results and options, and returns an ordered array.

import { groupByCharacter } from './generate.js';

// The chips offer shape families, not characters. At two kits there are
// eight characters — "8-corner shape 3 with chicane" and friends — which
// is far too many chips for a 640px dialog, and the labels are longer than
// the cards they filter. Three families plus a chicane toggle covers the
// same ground in four controls, and the set does not grow with inventory.
export function outlineFamily(characterName) {
  const outline = characterName.replace(/ with chicane$/, '');
  return outline.startsWith('8-corner') ? '8-corner' : outline;
}

const FAMILY_ORDER = ['Rectangle', 'L-shape', '8-corner'];

// Only families with something in them. A chip for a family this inventory
// cannot build is a button that always returns nothing.
export function availableFamilies(results) {
  const present = new Set(annotate(results).map((r) => outlineFamily(r.characterName)));
  return FAMILY_ORDER.filter((f) => present.has(f));
}

// Stamp each result with the character it belongs to: the row label needs
// the character's name rather than the bare outline ("L-shape with
// chicane", not "L-shape"), and the chicane toggle needs the flag.
function annotate(results) {
  const out = [];
  for (const character of groupByCharacter(results)) {
    for (const variant of character.variants) {
      out.push({ ...variant, characterName: character.name, chicane: character.chicane });
    }
  }
  return out;
}

// Order one character's variants so consecutive picks look different.
// Score alone puts near-identical layouts side by side — at one starter
// kit every L-shape is 8x8 and 48 mats — so the page reads as duplicated
// even when the tracks differ. Best first, then whichever remaining
// variant shares fewest mats with the ones already taken.
function diverseOrder(variants) {
  if (variants.length < 3) return [...variants];
  const cells = new Map(variants.map((v) => [v, new Set(v.key.split(';'))]));
  const overlap = (a, b) => {
    const [x, y] = [cells.get(a), cells.get(b)];
    let shared = 0;
    for (const c of x) if (y.has(c)) shared += 1;
    return shared / (x.size + y.size - shared);
  };
  const remaining = [...variants].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const ordered = [remaining.shift()];
  while (remaining.length > 0) {
    let bestAt = 0;
    let bestScore = Infinity;
    remaining.forEach((candidate, i) => {
      // Only against the last few: the page shows five side by side, and
      // looking further back costs time without changing what is seen.
      const worst = Math.max(...ordered.slice(-4).map((taken) => overlap(taken, candidate)));
      if (worst < bestScore) { bestScore = worst; bestAt = i; }
    });
    ordered.push(remaining.splice(bestAt, 1)[0]);
  }
  return ordered;
}

// "Best" is the only order that spreads the shapes: round-robin across
// characters, each character's own variants in diverse order, strongest
// character first. The point is that page one is not five of the same
// shape. The other sorts deliberately do NOT spread — the user picked a
// dimension and expects that dimension, in order, nothing else.
function bestOrder(annotated) {
  const byCharacter = new Map();
  for (const r of annotated) {
    if (!byCharacter.has(r.characterName)) byCharacter.set(r.characterName, []);
    byCharacter.get(r.characterName).push(r);
  }
  const queues = [...byCharacter.values()]
    .map(diverseOrder)
    .sort((a, b) => (b[0]?.score ?? 0) - (a[0]?.score ?? 0));

  const pool = [];
  while (queues.some((q) => q.length > 0)) {
    for (const q of queues) if (q.length > 0) pool.push(q.shift());
  }
  return pool;
}

const area = (r) => r.bbox.w * r.bbox.h;

const SORTS = {
  best: bestOrder,
  lap: (rs) => [...rs].sort((a, b) => b.lapMm - a.lapMm || a.key.localeCompare(b.key)),
  mats: (rs) => [...rs].sort((a, b) => a.matCount - b.matCount || a.key.localeCompare(b.key)),
  size: (rs) => [...rs].sort((a, b) => area(a) - area(b) || a.key.localeCompare(b.key)),
};

// Every strict sort ties on `key` last so the order is total and stable —
// mats and footprint tie constantly, and an order that rests on sort
// stability plus generation order is an accident rather than a rule.
export function orderSuggestions(results, { shape = 'all', chicanes = true, sort = 'best' } = {}) {
  let pool = annotate(results);
  if (shape !== 'all') pool = pool.filter((r) => outlineFamily(r.characterName) === shape);
  if (!chicanes) pool = pool.filter((r) => !r.chicane);
  return (SORTS[sort] ?? SORTS.best)(pool);
}

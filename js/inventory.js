import { computeBarriers, computeMetrics } from './model.js';

export const MAT_PARTS = ['square', 'quarterRound', 'arcLarge'];
export const BARRIER_PARTS = ['straight', 'curve', 'curveLarge', 'cornerCap'];

export const PART_LABELS = {
  'mats.square': 'Square mat',
  'mats.quarterRound': 'Quarter-round mat',
  'mats.arcLarge': 'Large-arc mat',
  'barriers.straight': 'Straight barrier',
  'barriers.curve': 'Curve barrier',
  'barriers.curveLarge': 'Large curve half',
  'barriers.cornerCap': 'Corner cap',
  'joints.a': 'Joint A',
  'joints.b': 'Joint B',
};

// Mounting holes per barrier, from the manual drawings. These reconcile
// the starter set exactly: 36*2 + 6*2 + 6*1 = 90 joints of each type.
export const MOUNT_POINTS = { straight: 2, curve: 2, curveLarge: 2, cornerCap: 1 };

// priceRank: a relative cheapest-first ordering hint used only to sort
// recommendKit's candidates — not sourced from any manual or price list,
// just an unverified guess at kit price order. The headline recommendation
// (renderBom's "Short on pieces — <kit> covers it") sorts on this, so treat
// which kit gets named with that in mind.
export const KITS = {
  '87033': {
    name: 'Circuit 30 Starter, 48 pcs',
    priceRank: 3,
    mats: { square: 42, quarterRound: 6 },
    barriers: { straight: 36, curve: 6, cornerCap: 6 },
    joints: { a: 90, b: 90 },
  },
  '87031': {
    name: 'Circuit 30, 96 pcs',
    priceRank: 4,
    mats: { square: 84, quarterRound: 12 },
    barriers: { straight: 72, curve: 12, cornerCap: 12 },
    joints: { a: 180, b: 180 },
  },
  '87033-01': {
    name: 'Circuit 30 Expansion, 63 pcs',
    priceRank: 2,
    // 63 here vs. spec §2.2's 36 + 26 = 62: the kit is sold and boxed as
    // "63 pcs" (this constant), while 87031-01 is documented as the 62-pcs
    // variant of the same expansion. Defensible as two real, differently
    // counted SKUs rather than a typo, but code and spec disagree on their
    // face — flagged here rather than silently changed without evidence.
    mats: { square: 63 },
    barriers: { straight: 26 },
    joints: { a: 52, b: 52 },
  },
  '87033-02': {
    name: 'Large Corner Expansion, 12 pcs',
    priceRank: 1,
    mats: { square: 4, arcLarge: 8 },
    barriers: { curveLarge: 8 },
    joints: { a: 16, b: 16 },
  },
};

export function emptyStock() {
  const mats = Object.fromEntries(MAT_PARTS.map((p) => [p, 0]));
  const barriers = Object.fromEntries(BARRIER_PARTS.map((p) => [p, 0]));
  return { mats, barriers, joints: { a: 0, b: 0 } };
}

export function stockFromKits(counts) {
  const stock = emptyStock();
  for (const [id, n] of Object.entries(counts)) {
    const kit = KITS[id];
    if (!kit || !n) continue;
    for (const p of MAT_PARTS) stock.mats[p] += (kit.mats[p] ?? 0) * n;
    for (const p of BARRIER_PARTS) stock.barriers[p] += (kit.barriers[p] ?? 0) * n;
    stock.joints.a += kit.joints.a * n;
    stock.joints.b += kit.joints.b * n;
  }
  return stock;
}

export function billOfMaterials(layout) {
  const { mats } = computeMetrics(layout);
  const { counts } = computeBarriers(layout);
  const mounts = BARRIER_PARTS.reduce(
    (total, p) => total + counts[p] * MOUNT_POINTS[p], 0,
  );
  return { mats, barriers: counts, joints: { a: mounts, b: mounts } };
}

const flatten = (bag) => [
  ...MAT_PARTS.map((p) => [`mats.${p}`, bag.mats?.[p] ?? 0]),
  ...BARRIER_PARTS.map((p) => [`barriers.${p}`, bag.barriers?.[p] ?? 0]),
  ['joints.a', bag.joints?.a ?? 0],
  ['joints.b', bag.joints?.b ?? 0],
];

export function diffStock(bom, stock) {
  const owned = Object.fromEntries(flatten(stock));
  return flatten(bom).map(([part, used]) => ({
    part,
    label: PART_LABELS[part],
    owned: owned[part],
    used,
    short: Math.max(0, used - owned[part]),
  }));
}

export function recommendKit(rows, kits = KITS) {
  const shortfalls = rows.filter((r) => r.short > 0);
  if (shortfalls.length === 0) return null;

  const candidates = Object.entries(kits)
    .filter(([, kit]) => shortfalls.every((r) => {
      const [group, part] = r.part.split('.');
      const supplied = group === 'joints' ? kit.joints[part] : (kit[group]?.[part] ?? 0);
      return supplied >= r.short;
    }))
    .sort((a, b) => a[1].priceRank - b[1].priceRank);

  if (candidates.length === 0) return null;
  const [id, kit] = candidates[0];
  return { id, name: kit.name };
}

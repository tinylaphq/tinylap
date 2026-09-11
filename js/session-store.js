// The work-in-progress layout, kept for the life of the tab.
//
// sessionStorage rather than localStorage on purpose: this is the thing
// you are in the middle of, not a saved document. It survives a reload or
// an accidental navigation, and goes when the tab does. Keeping a layout
// forever would mean reopening the planner months later to someone else's
// half-finished track with no obvious way back to a blank canvas — Save
// and Open are how a layout is meant to outlive a session.
//
// Only the layout is stored: version, unit, room, pieces. Selection,
// ghosts and the inventory are not part of a layout and are not persisted
// here (the inventory has its own store, and belongs to the owner rather
// than to any one track).

import { layoutFromData } from './storage.js';

export const LAYOUT_STORAGE_KEY = 'circuit30.layout';

// A stored value is untrusted: it can be absent, truncated by a crash, or
// hand-edited. Anything that is not a layout this build can read gives
// null — a blank canvas — rather than throwing on startup. It is validated
// by exactly the rules that guard an opened file (layoutFromData), so a
// payload cannot reach the renderer through this door that could not
// reach it through that one.
export function parseLayout(raw) {
  if (typeof raw !== 'string') return null;
  try {
    return layoutFromData(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadLayout(storage) {
  try {
    return parseLayout(storage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    return null;                                   // storage can be denied
  }
}

export function saveLayout(storage, layout) {
  try {
    const { version, unit, room, pieces } = layout;
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ version, unit, room, pieces }));
  } catch {
    /* Denied or full. The layout still works for this session; Save is
       the durable path and it does not depend on this. */
  }
}

export function clearLayout(storage) {
  try {
    storage.removeItem(LAYOUT_STORAGE_KEY);
  } catch {
    /* as above */
  }
}

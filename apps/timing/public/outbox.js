// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge's outbox (spec §5): passings read from the cable wait here until
// the server holds them, so an internet outage or a reload loses nothing.
// Keyed by the passing key, so the same passing is kept once.

import { passingKey as keyOf } from '@tinylap/timing';

const STORE = 'outbox';

export function memoryOutbox() {
  const items = new Map();
  return {
    async add(p) {
      items.set(keyOf(p), p);
    },
    async list() {
      return [...items.values()];
    },
    async count() {
      return items.size;
    },
    /** Drops these passings (the ones a batch carried). @param {{ decoder: string, boot: string, transponder: string, t: number }[]} passings */
    async remove(passings) {
      for (const p of passings) items.delete(keyOf(p));
    },
  };
}

/** Runs `fn` in a transaction; resolves with its request's result once committed. */
function inTransaction(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The IndexedDB outbox, or a memory one where IndexedDB is unavailable (private windows, Node). */
export async function openOutbox(name = 'tinylap-timing') {
  let db;
  try {
    // A hung or blocked open falls back to memory after 1 s, so it can't leave Connect dead.
    db = await new Promise((resolve, reject) => {
      let timer;
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: ['decoder', 'boot', 'transponder', 't'] });
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(request.error);
      };
      request.onblocked = () => {
        clearTimeout(timer);
        reject(new Error('IndexedDB open blocked'));
      };
      timer = setTimeout(() => {
        reject(new Error('IndexedDB open timeout'));
      }, 1000);
    });
  } catch {
    return memoryOutbox();
  }
  return {
    add: (p) => inTransaction(db, 'readwrite', (store) => store.put(p)).then(() => {}),
    list: () => inTransaction(db, 'readonly', (store) => store.getAll()),
    count: () => inTransaction(db, 'readonly', (store) => store.count()),
    remove: (passings) => inTransaction(db, 'readwrite', (store) => {
      for (const p of passings) store.delete([p.decoder, p.boot, p.transponder, p.t]);
      return null;
    }),
  };
}

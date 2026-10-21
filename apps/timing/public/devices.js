// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Which decoder a device was chosen as, in this browser (decoders spec §3.2).
// A device is its USB chip, not the decoder, so this only suggests: the
// bridge asks the member to confirm on every connect. It keeps the choice
// alone, `{ decoder }`, never a boot or a clock (owner's decision).

const STORE = 'devices';

export function memoryDevices() {
  const items = new Map();
  const key = (workspace, device) => `${workspace} ${device}`;
  return {
    /** @param {string} workspace @param {string} device @returns {Promise<string | null>} */
    async recall(workspace, device) {
      return items.get(key(workspace, device))?.decoder ?? null;
    },
    /** @param {string} workspace @param {string} device @param {string} decoder */
    async remember(workspace, device, decoder) {
      items.set(key(workspace, device), { decoder });
    },
    /** @param {string} workspace @param {string} device */
    async forget(workspace, device) {
      items.delete(key(workspace, device));
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

/** The IndexedDB devices, or memory ones where IndexedDB is unavailable (private windows, Node). */
export async function openDevices(name = 'tinylap-bridge-devices') {
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return memoryDevices();
  }
  return {
    recall: (workspace, device) => inTransaction(db, 'readonly', (store) => store.get([workspace, device])).then((r) => r?.decoder ?? null),
    remember: (workspace, device, decoder) => inTransaction(db, 'readwrite', (store) => store.put({ decoder }, [workspace, device])).then(() => {}),
    forget: (workspace, device) => inTransaction(db, 'readwrite', (store) => store.delete([workspace, device])).then(() => {}),
  };
}

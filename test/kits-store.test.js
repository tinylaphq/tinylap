import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKits, loadKits, saveKits, DEFAULT_KITS, KITS_STORAGE_KEY } from '../js/kits-store.js';

const fakeStorage = (initial) => {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    dump: () => Object.fromEntries(map),
  };
};

test('a good payload round-trips', () => {
  assert.deepEqual(parseKits('{"87033":2,"87033-01":1}'), { '87033': 2, '87033-01': 1 });
});

test('unknown kit ids are dropped rather than trusted', () => {
  assert.deepEqual(parseKits('{"87033":1,"not-a-kit":5}'), { '87033': 1 });
});

test('non-numeric, negative and fractional counts are rejected', () => {
  assert.deepEqual(parseKits('{"87033":"two"}'), DEFAULT_KITS);
  assert.deepEqual(parseKits('{"87033":-1}'), DEFAULT_KITS);
  assert.deepEqual(parseKits('{"87033":1.5}'), DEFAULT_KITS);
});

test('malformed or absent storage falls back to the default, never throws', () => {
  assert.deepEqual(parseKits('not json'), DEFAULT_KITS);
  assert.deepEqual(parseKits(null), DEFAULT_KITS);
  assert.deepEqual(parseKits('[]'), DEFAULT_KITS);
  assert.deepEqual(loadKits(fakeStorage()), DEFAULT_KITS);
});

test('a storage that throws does not break the app', () => {
  const hostile = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadKits(hostile), DEFAULT_KITS);
  assert.doesNotThrow(() => saveKits(hostile, { '87033': 1 }));
});

test('save then load returns what was saved', () => {
  const s = fakeStorage();
  saveKits(s, { '87033': 3 });
  assert.equal(typeof s.dump()[KITS_STORAGE_KEY], 'string');
  assert.deepEqual(loadKits(s), { '87033': 3 });
});

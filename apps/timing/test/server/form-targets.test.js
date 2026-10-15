// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// After a 422, 429 or 502 the address bar shows a form's POST target, so a
// reload, bookmark or share is a GET there: it goes to the page the form is on.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let ana;
let owner;
let office;

before(async () => {
  app = await startTiming();
  ana = await app.signUp('Ana');
  office = app.club(ana, 'Office');
  owner = await app.login(ana);
});
after(() => app.close());

const TARGETS = [
  ['drivers', 'setup#drivers'],
  ['drivers/d1', 'setup#drivers'],
  ['transponders/00AB', 'setup#transponders'],
  ['track', 'setup#track'],
  ['decoders', 'setup#decoders'],
  ['watch-link', 'setup#watchers'],
  ['sessions', 'race'],
];

test('a GET on a form target goes to the page the form is on', async () => {
  for (const [path, page] of TARGETS) {
    const res = await app.api(owner, 'GET', `/clubs/${office.id}/${path}`, undefined, { accept: 'text/html' });
    assert.equal(res.status, 303, path);
    assert.equal(res.headers.get('location'), `/clubs/${office.id}/${page}`, path);
  }
});

test('on the personal space too, and signed out goes to sign-in', async () => {
  const personal = await app.api(owner, 'GET', '/personal/drivers', undefined, { accept: 'text/html' });
  assert.equal(personal.headers.get('location'), '/personal/setup#drivers');
  const out = await app.api(null, 'GET', '/personal/sessions');
  assert.equal(out.status, 303);
  assert.match(out.headers.get('location'), /^\/auth\/login\?returnTo=/);
});

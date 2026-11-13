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
  ['track', 'setup#track'],
  ['decoders', 'setup#decoders'],
  ['watch-link', 'setup#watchers'],
];

test('a GET on a form target goes to the page the form is on', async () => {
  for (const [path, page] of TARGETS) {
    const res = await app.api(owner, 'GET', `/clubs/${office.id}/${path}`, undefined, { accept: 'text/html' });
    assert.equal(res.status, 303, path);
    assert.equal(res.headers.get('location'), `/clubs/${office.id}/${page}`, path);
  }
});

test('a GET on a transponder\'s target shows its form', async () => {
  const res = await app.api(owner, 'GET', `/clubs/${office.id}/transponders/00AB`, undefined, { accept: 'text/html' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Whose transponder is <span class="assign-big">00AB<\/span>\?/);
});

test('a GET on a driver\'s target shows their page, or not found', async () => {
  app.store.ensureWorkspace(office.id);
  app.store.addDriver(office.id, { id: 'd1', name: 'Dan', colour: '#123456' });
  const res = await app.api(owner, 'GET', `/clubs/${office.id}/drivers/d1`, undefined, { accept: 'text/html' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<h1[^>]*>Dan<\/h1>/);
  assert.equal((await app.api(owner, 'GET', `/clubs/${office.id}/drivers/d2`, undefined, { accept: 'text/html' })).status, 404);
});

test('on the personal space too, and signed out goes to sign-in', async () => {
  const personal = await app.api(owner, 'GET', '/personal/drivers', undefined, { accept: 'text/html' });
  assert.equal(personal.headers.get('location'), '/personal/setup#drivers');
  const out = await app.api(null, 'GET', '/personal/sessions');
  assert.equal(out.status, 303);
  assert.match(out.headers.get('location'), /^\/auth\/login\?returnTo=/);
});

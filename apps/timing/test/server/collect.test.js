// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Collect (drivers and transponders spec §3.6): a row per unassigned transponder,
// each with a driver form and a new-driver form; the 303 back here says whose it
// is now, and a refused form comes back with its error and input, 422.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let owner;
let office;
let base;

before(async () => {
  app = await startTiming();
  const ana = await app.signUp('Ana');
  office = app.club(ana, 'Office');
  owner = await app.login(ana);
  base = `/clubs/${office.id}`;
  app.store.ensureWorkspace(office.id);
  app.store.addDriver(office.id, { id: 'simon', name: 'Simon', colour: '#ff8a00' });
  app.store.addDriver(office.id, { id: 'mia', name: 'Mia Kraus', colour: '#00b3c7' });
  app.store.assignTransponder(office.id, '17', 'simon', Date.now());
  for (const [code, ago] of [['41', 60_000], ['52', 30_000], ['66', 10_000]]) {
    app.store.seeTransponder(office.id, code, Date.now() - ago);
    app.store.insertPassing({ decoder: 'd1', boot: 'b', transponder: code, t: 1, receivedAt: Date.now() - ago, via: 'net', workspaceId: office.id });
  }
});
after(() => app.close());

const get = (path) => app.api(owner, 'GET', path, undefined, { accept: 'text/html' });
const rowOf = (body, code) => body.match(new RegExp(`<li class="collect-row" data-code="${code}">[\\s\\S]*?</li>`))?.[0] ?? null;
const back = (code) => `${base}/transponders/new?assigned=${code}`;

test('a row per unassigned transponder, newest first, each with a driver form and a new-driver form', async () => {
  const res = await get(`${base}/transponders/new`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<h1 id="collect-title">New transponders<\/h1>/);
  assert.match(body, /3 crossed the line and aren't assigned yet\./);
  assert.equal(rowOf(body, '17'), null, 'an assigned one has no row');
  assert.deepEqual([...body.matchAll(/data-code="(\w+)"/g)].map((m) => m[1]), ['66', '52', '41']);
  assert.match(body, new RegExp(`<tl-crossing-now src="/workspaces/${office.id}/live">\\s*<tl-frame id="collect">`));
  assert.match(body, /<script type="module" src="\/public\/elements\/crossing-now\.js"><\/script>/);
  const row = rowOf(body, '41');
  assert.match(row, /<span class="tp">41<\/span>/);
  assert.match(row, /<span class="crossing-now" hidden>Crossing now<\/span><span class="crossed">Crossed <time[^>]*>1 min ago<\/time><\/span>/);
  assert.match(row, /<label for="collect-41-driver">Driver<\/label>\s*<select id="collect-41-driver" name="driver">\s*<option value="" selected>Choose a driver<\/option><option value="mia">Mia Kraus<\/option><option value="simon">Simon<\/option>/);
  assert.match(row, /<button type="submit" class="btn btn-outline">Assign<span class="visually-hidden"> transponder 41<\/span><\/button>/);
  assert.match(row, /<p class="collect-or">or<\/p>/);
  assert.match(row, /<label for="collect-41-name">A new driver<\/label>\s*<input type="text" id="collect-41-name" name="name" value="" maxlength="60" placeholder="Name">/);
  assert.match(row, /<button type="submit" class="btn btn-outline">Add and assign<span class="visually-hidden"> transponder 41<\/span><\/button>/);
  assert.equal([...row.matchAll(new RegExp(`<form method="post" action="${base}/transponders/41" class="space-sm">`, 'g'))].length, 2);
  assert.match(row, new RegExp(`<input type="hidden" name="returnTo" value="${back('41').replace('?', '\\?')}">`));
  assert.match(row, new RegExp(`<input type="hidden" name="returnTo" value="${back('41').replace('?', '\\?')}&amp;added=1">`));
  assert.doesNotMatch(body.replace(/<[^>]*>/g, ' '), /\bcode\b/i, 'no "code" on screen');
});

test('Assign gives it to the driver, and the page then says so, without its row', async () => {
  const res = await app.form(owner, `${base}/transponders/41`, { returnTo: back('41'), from: 'collect', driver: 'mia' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), back('41'));
  assert.equal(app.store.transponders(office.id).find((t) => t.code === '41').driverId, 'mia');
  const body = await (await get(back('41'))).text();
  const change = `${base}/transponders/41?returnTo=${encodeURIComponent(`${base}/transponders/new`)}`;
  assert.match(body, new RegExp(`<p class="status status-success cut-words" role="status">Transponder 41 is Mia Kraus's now\\. <a href="${change.replace('?', '\\?')}">Change</a></p>`));
  assert.equal(rowOf(body, '41'), null);
  assert.match(body, /2 crossed the line and aren't assigned yet\./);
});

test('Add and assign adds one driver and gives it to them', async () => {
  const before = app.store.drivers(office.id).length;
  const res = await app.form(owner, `${base}/transponders/52`, { returnTo: `${back('52')}&added=1`, from: 'collect', name: 'Lena' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${back('52')}&added=1`);
  const drivers = app.store.drivers(office.id);
  assert.equal(drivers.length, before + 1);
  const lena = drivers.find((d) => d.name === 'Lena');
  assert.equal(app.store.transponders(office.id).find((t) => t.code === '52').driverId, lena.id);
  const body = await (await get(`${back('52')}&added=1`)).text();
  assert.match(body, /Transponder 52 is Lena's now, a new driver\. <a href="[^"]+">Change<\/a><\/p>/);
  assert.match(body, /1 crossed the line and isn't assigned yet\./);
});

test('a line only for a transponder that is assigned', async () => {
  const body = await (await get(back('66'))).text();
  assert.doesNotMatch(body, /status-success/);
});

test('Add and assign with a blank name comes back as collect, the error on that form, 422', async () => {
  const before = app.store.drivers(office.id).length;
  const res = await app.form(owner, `${base}/transponders/66`, { returnTo: `${back('66')}&added=1`, from: 'collect', name: '  ' });
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.equal(app.store.drivers(office.id).length, before);
  assert.match(body, /<p class="status status-error cut-words" role="alert"><a href="#collect-66-name">Name the new driver\.<\/a><\/p>/);
  const row = rowOf(body, '66');
  assert.match(row, /<input type="text" id="collect-66-name" name="name" value=" {2}" maxlength="60" placeholder="Name" aria-invalid="true" aria-describedby="collect-66-name-error">/);
  assert.match(row, /<\/div>\s*<p class="field-error" id="collect-66-name-error">Name the new driver\.<\/p>/, 'below its row');
  assert.doesNotMatch(row, /<select[^>]*aria-invalid/, 'the driver form is fine');
  assert.equal(app.store.transponders(office.id).find((t) => t.code === '66').driverId, null);
});

test('Assign without a driver chosen comes back with the error on the driver, 422; a name too long keeps it', async () => {
  const res = await app.form(owner, `${base}/transponders/66`, { returnTo: back('66'), from: 'collect', driver: '' });
  assert.equal(res.status, 422);
  const row = rowOf(await res.text(), '66');
  assert.match(row, /<select id="collect-66-driver" name="driver" aria-invalid="true" aria-describedby="collect-66-driver-error">/);
  assert.match(row, /<p class="field-error" id="collect-66-driver-error">Choose a driver\.<\/p>/);
  const long = 'L'.repeat(61);
  const again = await app.form(owner, `${base}/transponders/66`, { returnTo: back('66'), from: 'collect', name: long });
  assert.equal(again.status, 422);
  assert.match(rowOf(await again.text(), '66'), new RegExp(`id="collect-66-name" name="name" value="${long}"`));
});

test('with every transponder assigned, the page says how one shows up', async () => {
  await app.form(owner, `${base}/transponders/66`, { returnTo: back('66'), from: 'collect', driver: 'simon' });
  const body = await (await get(back('66'))).text();
  assert.match(body, /Transponder 66 is Simon's now\./);
  assert.match(body, /<p class="empty">Run its car over the line, and it shows up here\.<\/p>/);
  assert.doesNotMatch(body, /crossed the line and/);
});

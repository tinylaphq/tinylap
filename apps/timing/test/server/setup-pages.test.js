// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup as pages and forms (spec §3, §5, §6.4): drivers and transponders.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';

let app;
let ana;
let owner;
let member;
let office;
let base;

before(async () => {
  app = await startTiming();
  ana = await app.signUp('Ana');
  const ben = await app.signUp('Ben');
  office = app.club(ana, 'Office');
  app.join(ana, office.id, ben);
  owner = await app.login(ana);
  member = await app.login(ben);
  base = `/clubs/${office.id}`;
});
after(() => app.close());

const get = (who, path) => app.api(who, 'GET', path, undefined, { accept: 'text/html' });
const drivers = () => app.store.drivers(office.id);

test('the setup page has a section per thing to set up', async () => {
  const res = await get(owner, `${base}/setup`);
  assert.equal(res.status, 200);
  const body = await res.text();
  for (const id of ['track', 'drivers', 'transponders', 'watchers']) assert.match(body, new RegExp(`<tl-frame id="${id}"[^>]*><section`), id);
  assert.match(body, /<section[^>]* id="decoders"/);
  assert.match(body, new RegExp(`<form method="post" action="${base}/drivers"`));
  assert.match(body, /<label for="add-driver-name">New driver<\/label>/);
  assert.doesNotMatch(body, /workspace/i);
});

test('adding a driver is a form and a redirect back to the drivers', async () => {
  const res = await app.form(member, `${base}/drivers`, { name: '<b>Dan</b>' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/setup#drivers`);
  assert.deepEqual(drivers().map((d) => d.name), ['<b>Dan</b>']);
  const body = await (await get(member, `${base}/setup`)).text();
  assert.match(body, /&lt;b&gt;Dan&lt;\/b&gt;/);
  assert.doesNotMatch(body, /<b>Dan<\/b>/);
});

test('a name with a line break comes back as the page, 422, nothing saved', async () => {
  const before = drivers().length;
  for (const name of ['Dan\rid: 9', 'Dan\nevent: ended']) {
    const res = await app.form(member, `${base}/drivers`, { name });
    assert.equal(res.status, 422);
    assert.match(await res.text(), /Give the driver a name of 1 to 60 characters\./);
  }
  assert.equal(drivers().length, before);
});

test('a bad name comes back as the page, 422, the input kept and the field marked', async () => {
  const long = 'x'.repeat(61);
  const res = await app.form(member, `${base}/drivers`, { name: long });
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, /Give the driver a name of 1 to 60 characters\./);
  assert.match(body, new RegExp(`<input[^>]*id="add-driver-name"[^>]*value="${long}"[^>]*aria-invalid="true"`));
  assert.equal(drivers().length, 1);
});

test('renaming a driver', async () => {
  const [dan] = drivers();
  const res = await app.form(member, `${base}/drivers/${dan.id}`, { name: 'Dan' });
  assert.equal(res.status, 303);
  assert.equal(drivers()[0].name, 'Dan');
});

test('the rename form carries a colour picker with the driver\'s colour', async () => {
  const [dan] = drivers();
  const body = await (await get(member, `${base}/setup`)).text();
  assert.match(body, new RegExp(`<label for="colour-${dan.id}" class="visually-hidden">Colour for Dan</label>`));
  assert.match(body, new RegExp(`<input type="color" id="colour-${dan.id}" name="colour" value="${dan.colour}"`));
});

test('changing a driver\'s colour saves it with the name, and the page shows it', async () => {
  const [dan] = drivers();
  const res = await app.form(member, `${base}/drivers/${dan.id}`, { name: 'Dan', colour: '#12AB9F' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/setup#drivers`);
  assert.deepEqual([drivers()[0].name, drivers()[0].colour], ['Dan', '#12ab9f']);
  const body = await (await get(member, `${base}/setup`)).text();
  assert.match(body, new RegExp(`<input type="color" id="colour-${dan.id}" name="colour" value="#12ab9f"`));
});

test('a colour that is not #rrggbb is a 422, the input kept and nothing saved', async () => {
  const [dan] = drivers();
  for (const colour of ['red; background: url(x)', 'red', '#12ab9', '#12ab9f; x', '']) {
    const res = await app.form(member, `${base}/drivers/${dan.id}`, { name: 'Danny', colour });
    assert.equal(res.status, 422, colour);
    const body = await res.text();
    assert.match(body, new RegExp(`<p class="status status-error" role="alert"><a href="#colour-${dan.id}">A colour is #rrggbb\\.</a></p>`));
    const kept = colour.replace(/[()]/g, '\\$&');
    assert.match(body, new RegExp(`<input type="color" id="colour-${dan.id}" name="colour" value="${kept}"[^>]*aria-invalid="true"`), colour);
    assert.match(body, new RegExp(`<input[^>]*id="rename-${dan.id}"[^>]*value="Danny"`));
    assert.doesNotMatch(body, /--driver: red/);
  }
  assert.deepEqual([drivers()[0].name, drivers()[0].colour], ['Dan', '#12ab9f']);
});

test('deleting asks first, needs an admin, and unassigns the transponder', async () => {
  const [dan] = drivers();
  app.engine.assign(office.id, '4711', dan.id);
  assert.equal((await get(member, `${base}/drivers/${dan.id}/delete`)).status, 403);
  const ask = await get(owner, `${base}/drivers/${dan.id}/delete`);
  assert.equal(ask.status, 200);
  const body = await ask.text();
  assert.match(body, /<h1>Delete Dan\?<\/h1>/);
  assert.match(body, new RegExp(`<form method="post" action="${base}/drivers/${dan.id}/delete"`));
  assert.match(body, new RegExp(`<a[^>]*href="${base}/setup#drivers"[^>]*>Cancel</a>`));
  assert.equal((await app.form(member, `${base}/drivers/${dan.id}/delete`, {})).status, 403);
  const done = await app.form(owner, `${base}/drivers/${dan.id}/delete`, {});
  assert.equal(done.status, 303);
  assert.deepEqual(drivers(), []);
  assert.equal(app.store.transponders(office.id).find((t) => t.code === '4711').driverId, null);
});

test('assigning and unassigning a transponder', async () => {
  const added = await app.form(owner, `${base}/drivers`, { name: 'Eve' });
  assert.equal(added.status, 303);
  const [eve] = drivers();
  let res = await app.form(owner, `${base}/transponders/4711`, { driver: eve.id });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${base}/setup#transponders`);
  assert.equal(app.store.transponders(office.id).find((t) => t.code === '4711').driverId, eve.id);
  await app.form(owner, `${base}/transponders/4711`, { driver: '' });
  assert.equal(app.store.transponders(office.id).find((t) => t.code === '4711').driverId, null);
  res = await app.form(owner, `${base}/transponders/4711`, { driver: 'nobody' });
  assert.equal(res.status, 422);
  assert.match(await res.text(), /Pick one of the drivers here, or none\./);
});

test('a form from another site changes nothing', async () => {
  const before = drivers().length;
  const res = await app.form(owner, `${base}/drivers`, { name: 'Mallory' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /<h1>Not allowed<\/h1>/);
  assert.equal(drivers().length, before);
});

test('after signing out, resubmitting a form sends you to sign in and changes nothing', async () => {
  const before = drivers().length;
  const gil = await app.signUp('Gil');
  app.join(ana, office.id, gil);
  const fresh = await app.login(gil);
  await app.api(fresh, 'POST', '/auth/logout');
  const res = await app.form(fresh, `${base}/drivers`, { name: 'Late' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/auth/login?returnTo=%2F');
  assert.equal(drivers().length, before);
});

test('a member sees no Delete links, an admin does', async () => {
  const added = await app.form(owner, `${base}/drivers`, { name: 'Fay' });
  assert.equal(added.status, 303);
  const asMember = await (await get(member, `${base}/setup`)).text();
  assert.match(asMember, />Fay</);
  assert.doesNotMatch(asMember, /\/delete"/);
  assert.match(await (await get(owner, `${base}/setup`)).text(), /\/delete"/);
});

test('a blank rename is a 422 with the summary linking the field, and the input kept', async () => {
  const fay = drivers().find((d) => d.name === 'Fay');
  const res = await app.form(member, `${base}/drivers/${fay.id}`, { name: '   ' });
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, new RegExp(`<p class="status status-error" role="alert"><a href="#rename-${fay.id}">Give the driver a name of 1 to 60 characters\\.</a></p>`));
  assert.match(body, new RegExp(`<input[^>]*id="rename-${fay.id}"[^>]*value="   "[^>]*aria-invalid="true"`));
  assert.equal(drivers().find((d) => d.id === fay.id).name, 'Fay');
});

test('an error without a field shows in the summary, also for a vanished driver\'s delete and confirm page', async () => {
  const gone = drivers().find((d) => d.name === 'Fay');
  assert.equal((await app.form(owner, `${base}/drivers/${gone.id}/delete`, {})).status, 303);
  const rename = await app.form(member, `${base}/drivers/${gone.id}`, { name: 'Fay again' });
  assert.equal(rename.status, 404);
  assert.match(await rename.text(), /<p class="status status-error" role="alert">There is no such driver here\.<\/p>/);
  const del = await app.form(owner, `${base}/drivers/${gone.id}/delete`, {});
  assert.equal(del.status, 404);
  const body = await del.text();
  assert.match(body, /<p class="status status-error" role="alert">There is no such driver here\.<\/p>/);
  assert.doesNotMatch(body, /aria-invalid/);
  const ask = await get(owner, `${base}/drivers/${gone.id}/delete`);
  assert.equal(ask.status, 404);
  assert.match(await ask.text(), /role="alert">There is no such driver here\./);
});

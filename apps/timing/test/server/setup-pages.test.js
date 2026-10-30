// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Setup as pages and forms (spec §3, §5, §6.4): drivers, transponders and
// the club's tracks (named tracks spec §3.3–3.5, §4).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTiming } from './helpers.js';
import { CLOSED, OPEN, OTHER, closed, other, startPlannerStub } from './planner-stub.js';

let app;
let planner;
let ana;
let owner;
let member;
let office;
let base;
let pits;
let pitsBase;

before(async () => {
  planner = await startPlannerStub();
  app = await startTiming({ plannerUrl: planner.url });
  ana = await app.signUp('Ana');
  const ben = await app.signUp('Ben');
  office = app.club(ana, 'Office');
  app.join(ana, office.id, ben);
  pits = app.club(ana, 'Pits');
  app.join(ana, pits.id, ben);
  pitsBase = `/clubs/${pits.id}`;
  owner = await app.login(ana);
  member = await app.login(ben);
  base = `/clubs/${office.id}`;
});
after(async () => {
  await app.close();
  await planner.close();
});

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

test('a colour that is not #rrggbb is a 422 in plain words, the name kept, the swatch on the saved colour, and nothing saved', async () => {
  const [dan] = drivers();
  for (const colour of ['red; background: url(x)', 'red', '#12ab9', '#12ab9f; x', '']) {
    const res = await app.form(member, `${base}/drivers/${dan.id}`, { name: 'Danny', colour });
    assert.equal(res.status, 422, colour);
    const body = await res.text();
    assert.match(body, new RegExp(`<p class="status status-error" role="alert"><a href="#colour-${dan.id}">Choose a colour with the swatch\\.</a></p>`));
    // A colour input can't show a refused value (it would turn black), so it shows the saved one.
    assert.match(body, new RegExp(`<input type="color" id="colour-${dan.id}" name="colour" value="#12ab9f"[^>]*aria-invalid="true"`), colour);
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

// The track list, in a club of its own: it starts with "Track", current, anticlockwise.
const tracks = () => [...app.store.tracks(pits.id, { archived: false }), ...app.store.tracks(pits.id, { archived: true })];
const trackNamed = (name) => tracks().find((t) => t.name === name);
const link = (key) => `${planner.url}/layouts/${key}`;

test('the track section lists the current track with its direction in words, and the forms', async () => {
  const body = await (await get(owner, `${pitsBase}/setup`)).text();
  const [track] = tracks();
  assert.match(body, new RegExp(`Now: <a href="${pitsBase}/tracks/${track.id}"><strong>Track</strong></a>, anticlockwise\\.`));
  assert.match(body, new RegExp(`<form method="post" action="${pitsBase}/track"`));
  assert.match(body, /<label for="current-track">Current track<\/label>/);
  assert.match(body, /<option value="ccw" selected>Anticlockwise<\/option>/);
  assert.match(body, /No layout/);
  assert.match(body, /<label for="add-track-name">Name<\/label>/);
  assert.match(body, /<label for="add-track-link">Planner link<\/label>/);
  assert.match(body, />Attach layout</);
  assert.doesNotMatch(body, />Make current</, 'the current track is not offered again');
  assert.doesNotMatch(body, />Archive</, 'nor archived');
  assert.doesNotMatch(body, /Archived tracks/);
});

test('adding a track by name, or with a planner link; it does not become current', async () => {
  const res = await app.form(member, `${pitsBase}/tracks`, { name: 'Office', link: '' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${pitsBase}/setup#track`);
  const office = trackNamed('Office');
  assert.equal(office.layout, null);
  assert.notEqual(app.store.workspace(pits.id).trackId, office.id);
  const withLayout = await app.form(member, `${pitsBase}/tracks`, { name: 'Garage', link: link(CLOSED) });
  assert.equal(withLayout.status, 303);
  assert.equal(trackNamed('Garage').layout.plannerId, closed.track.id);
  const body = await (await get(member, `${pitsBase}/setup`)).text();
  assert.match(body, />Make current</);
  assert.match(body, />Change layout</, 'Garage has a layout');
});

test('adding fails with 422 and the input kept: no name, a name in use, a bad link', async () => {
  const before = tracks().length;
  for (const [fields, message, fieldId] of [
    [{ name: '', link: link(CLOSED) }, /A track name is 1 to 60 characters\./, 'add-track-name'],
    [{ name: 'office', link: '' }, /A track named office is already in use\. Rename one of them first\./, 'add-track-name'],
    [{ name: 'Yard', link: link(OPEN) }, /not a closed circuit/, 'add-track-link'],
    // A link from elsewhere is refused before anything is fetched.
    [{ name: 'Yard', link: 'http://127.0.0.1:9/layouts/x' }, /role="alert"/, 'add-track-link'],
  ]) {
    const res = await app.form(member, `${pitsBase}/tracks`, fields);
    assert.equal(res.status, 422, fieldId);
    const body = await res.text();
    assert.match(body, message);
    assert.match(body, new RegExp(`<p class="status status-error" role="alert"><a href="#${fieldId}">`));
    assert.match(body, new RegExp(`<input[^>]*id="${fieldId}"[^>]*aria-invalid="true"`));
    assert.match(body, new RegExp(`id="add-track-name"[^>]*value="${fields.name}"`));
    assert.match(body, new RegExp(`id="add-track-link"[^>]*value="${fields.link}"`));
  }
  assert.equal(tracks().length, before);
});

test('renaming a track; a blank name or one in use is a 422 on its field', async () => {
  const office = trackNamed('Office');
  const res = await app.form(member, `${pitsBase}/tracks/${office.id}`, { name: 'Office loop' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${pitsBase}/setup#track`);
  assert.equal(app.store.track(pits.id, office.id).name, 'Office loop');
  for (const [name, message] of [['  ', /A track name is 1 to 60 characters\./], ['GARAGE', /A track named GARAGE is already in use\./]]) {
    const bad = await app.form(member, `${pitsBase}/tracks/${office.id}`, { name });
    assert.equal(bad.status, 422);
    const body = await bad.text();
    assert.match(body, message);
    assert.match(body, new RegExp(`<input[^>]*id="track-name-${office.id}"[^>]*value="${name}"[^>]*aria-invalid="true"`));
  }
  assert.equal(app.store.track(pits.id, office.id).name, 'Office loop');
});

test('attaching a layout to a track without one asks nothing; a bad link is a 422 with the link kept', async () => {
  const office = trackNamed('Office loop');
  const bad = await app.form(member, `${pitsBase}/tracks/${office.id}/layout`, { link: link(OPEN) });
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), new RegExp(`<input[^>]*id="track-link-${office.id}"[^>]*value="${link(OPEN)}"[^>]*aria-invalid="true"`));
  const res = await app.form(member, `${pitsBase}/tracks/${office.id}/layout`, { link: link(CLOSED) });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${pitsBase}/setup#track`);
  assert.equal(app.store.track(pits.id, office.id).layout.plannerId, closed.track.id);
  const again = await app.form(member, `${pitsBase}/tracks/${office.id}/layout`, { link: link(CLOSED) });
  assert.equal(again.status, 303, 'the same layout again needs no confirmation');
});

test('a different layout asks first, on a page that carries the link to both choices', async () => {
  const office = trackNamed('Office loop');
  const res = await app.form(member, `${pitsBase}/tracks/${office.id}/layout`, { link: link(OTHER) });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<h1>Change the layout of Office loop\?<\/h1>/);
  assert.match(body, /Records on Office loop stay and are compared with laps on the new layout\. If the track itself changed, add it as a new track instead\./);
  const change = new RegExp(`<form method="post" action="${pitsBase}/tracks/${office.id}/layout"[^>]*>\\s*<input type="hidden" name="link" value="${link(OTHER)}">\\s*<input type="hidden" name="confirm" value="1">\\s*<button type="submit" class="btn btn-primary">Change the layout</button>`);
  assert.match(body, change);
  assert.match(body, /Or add it as a new track:/);
  assert.match(body, new RegExp(`<form method="post" action="${pitsBase}/tracks/${office.id}/layout"[^>]*>\\s*<input type="hidden" name="link" value="${link(OTHER)}">\\s*<input type="hidden" name="as" value="new">`));
  assert.match(body, /<input type="text" id="new-track-name" name="name" value="" required maxlength="60">/);
  assert.match(body, />Add as a new track</);
  assert.match(body, new RegExp(`<a class="btn btn-outline" href="${pitsBase}/setup#track">Cancel</a>`));
  assert.equal(app.store.track(pits.id, office.id).layout.plannerId, closed.track.id, 'nothing changed yet');

  const confirmed = await app.form(member, `${pitsBase}/tracks/${office.id}/layout`, { link: link(OTHER), confirm: '1' });
  assert.equal(confirmed.status, 303);
  assert.equal(app.store.track(pits.id, office.id).layout.plannerId, other.track.id);
  const added = await app.form(member, `${pitsBase}/tracks/${office.id}/layout`, { as: 'new', name: 'Office two', link: link(CLOSED) });
  assert.equal(added.headers.get('location'), `${pitsBase}/setup#track`);
  assert.equal(added.status, 303);
  assert.equal(trackNamed('Office two').layout.plannerId, closed.track.id);
});

test('a failed new track on the layout confirmation comes back to the confirmation, the name kept and the link in both forms', async () => {
  const office = trackNamed('Office loop');
  const before = tracks().length;
  const res = await app.form(member, `${pitsBase}/tracks/${office.id}/layout`, { as: 'new', name: 'garage', link: link(OTHER) });
  assert.equal(res.status, 422);
  const body = await res.text();
  assert.match(body, /<h1>Change the layout of Office loop\?<\/h1>/);
  assert.match(body, /Records on Office loop stay and are compared with laps on the new layout\./);
  assert.match(body, /<p class="status status-error" role="alert"><a href="#new-track-name">A track named garage is already in use\. Rename one of them first\.<\/a><\/p>/);
  assert.match(body, /<input type="text" id="new-track-name" name="name" value="garage" required maxlength="60" aria-invalid="true"/);
  assert.equal(body.match(new RegExp(`<input type="hidden" name="link" value="${link(OTHER)}">`, 'g'))?.length, 2);
  assert.equal(tracks().length, before);
  assert.equal(app.store.track(pits.id, office.id).layout.plannerId, other.track.id, 'and the layout is as it was');
});

test('a track name is escaped on Setup and on the confirmation', async () => {
  assert.equal((await app.form(member, `${pitsBase}/tracks`, { name: '<b>x</b>', link: link(CLOSED) })).status, 303);
  const bold = trackNamed('<b>x</b>');
  const setup = await (await get(member, `${pitsBase}/setup`)).text();
  assert.match(setup, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(setup, /<b>x<\/b>/);
  const ask = await (await app.form(member, `${pitsBase}/tracks/${bold.id}/layout`, { link: link(OTHER) })).text();
  assert.match(ask, /Records on &lt;b&gt;x&lt;\/b&gt; stay/);
  assert.doesNotMatch(ask, /<b>x<\/b>/);
  await app.form(member, `${pitsBase}/tracks/${bold.id}/archive`, {});
  assert.equal((await app.form(owner, `${pitsBase}/tracks/${bold.id}/delete`, {})).status, 303);
});

test('making a track current with a direction; a bad direction is a 422', async () => {
  const garage = trackNamed('Garage');
  const res = await app.form(member, `${pitsBase}/track`, { id: garage.id, direction: 'cw' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${pitsBase}/setup#track`);
  assert.deepEqual([app.store.workspace(pits.id).trackId, app.store.workspace(pits.id).direction], [garage.id, 'cw']);
  const body = await (await get(member, `${pitsBase}/setup`)).text();
  assert.match(body, /Now: <a[^>]*><strong>Garage<\/strong><\/a>, clockwise\./);
  assert.match(body, new RegExp(`<option value="${garage.id}" selected>Garage</option>`));
  const bad = await app.form(member, `${pitsBase}/track`, { id: garage.id, direction: 'up' });
  assert.equal(bad.status, 422);
  assert.match(await bad.text(), /Pick the direction you race\./);
});

test('archiving needs no confirmation; the current track stays; restore brings it back', async () => {
  const office = trackNamed('Office two');
  const res = await app.form(member, `${pitsBase}/tracks/${office.id}/archive`, {});
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${pitsBase}/setup#track`);
  assert.notEqual(app.store.track(pits.id, office.id).archivedAt, null);
  const body = await (await get(member, `${pitsBase}/setup`)).text();
  assert.match(body, /<details[^>]*>\s*<summary>Archived tracks \(1\)<\/summary>/);
  assert.match(body, new RegExp(`<form method="post" action="${pitsBase}/tracks/${office.id}/restore"`));
  assert.doesNotMatch(body, new RegExp(`<option value="${office.id}"`), 'an archived track is not a choice');
  const current = await app.form(member, `${pitsBase}/tracks/${trackNamed('Garage').id}/archive`, {});
  assert.equal(current.status, 409);
  const refused = await current.text();
  assert.match(refused, /Garage is the current track\. Make another track current first\./);
  assert.doesNotMatch(refused, /aria-invalid/, 'the current track and direction are not the mistake');
  assert.equal((await app.form(member, `${pitsBase}/tracks/${office.id}/restore`, {})).status, 303);
  assert.equal(app.store.track(pits.id, office.id).archivedAt, null);
});

test('restoring a track whose name is now in use is refused, nothing changes', async () => {
  const office = trackNamed('Office two');
  await app.form(member, `${pitsBase}/tracks/${office.id}/archive`, {});
  await app.form(member, `${pitsBase}/tracks`, { name: 'Office two' });
  const res = await app.form(member, `${pitsBase}/tracks/${office.id}/restore`, {});
  assert.equal(res.status, 422);
  assert.match(await res.text(), /A track named Office two is already in use\. Rename one of them first\./);
  assert.notEqual(app.store.track(pits.id, office.id).archivedAt, null);
});

test('deleting an archived track asks first, with its sessions counted, and needs an admin', async () => {
  const office = tracks().find((t) => t.name === 'Office two' && t.archivedAt !== null);
  // Two sessions driven on it before it was archived.
  for (let i = 0; i < 2; i += 1) {
    app.store.addSession({ id: `pits-${i}`, workspaceId: pits.id, kind: 'practice', trackId: office.id, direction: 'ccw', state: 'done', createdAt: i, opensAt: i, closesAt: null, endedAt: i + 1, roster: null, durationMs: null });
  }
  assert.equal((await get(member, `${pitsBase}/tracks/${office.id}/delete`)).status, 403);
  const ask = await get(owner, `${pitsBase}/tracks/${office.id}/delete`);
  assert.equal(ask.status, 200);
  const body = await ask.text();
  assert.match(body, /<h1>Delete Office two\?<\/h1>/);
  assert.match(body, /<p>Its records and layouts are removed\. Its 2 sessions stay in the history, without a track\.<\/p>/);
  assert.match(body, new RegExp(`<form method="post" action="${pitsBase}/tracks/${office.id}/delete"`));
  assert.match(body, new RegExp(`<a[^>]*href="${pitsBase}/setup#track"[^>]*>Cancel</a>`));
  assert.match(await (await get(owner, `${pitsBase}/setup`)).text(), new RegExp(`href="${pitsBase}/tracks/${office.id}/delete"`));
  assert.doesNotMatch(await (await get(member, `${pitsBase}/setup`)).text(), new RegExp(`/tracks/${office.id}/delete"`));
  assert.equal((await app.form(member, `${pitsBase}/tracks/${office.id}/delete`, {})).status, 403);
  const done = await app.form(owner, `${pitsBase}/tracks/${office.id}/delete`, {});
  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), `${pitsBase}/setup#track`);
  assert.equal(app.store.track(pits.id, office.id), null);
});

test('a refused delete opens the archive, not the current-track form', async () => {
  await app.form(member, `${pitsBase}/tracks`, { name: 'Busy' });
  const busy = trackNamed('Busy');
  await app.form(member, `${pitsBase}/tracks/${busy.id}/archive`, {});
  app.store.addSession({ id: 'pits-busy', workspaceId: pits.id, kind: 'race', trackId: busy.id, direction: 'ccw', state: 'running', createdAt: 5, opensAt: 5, closesAt: 10, endedAt: null, roster: [], durationMs: 5 });
  const res = await app.form(owner, `${pitsBase}/tracks/${busy.id}/delete`, {});
  assert.equal(res.status, 409);
  const body = await res.text();
  assert.match(body, /Busy is in use by the running session\./);
  assert.doesNotMatch(body, /aria-invalid/);
  assert.match(body, /<details class="track-archive" open>/);
  app.store.updateSession('pits-busy', { state: 'aborted', endedAt: 6 });
});

test('an active track has no delete page; a missing one is 404', async () => {
  const garage = trackNamed('Garage');
  const ask = await get(owner, `${pitsBase}/tracks/${garage.id}/delete`);
  assert.equal(ask.status, 409);
  assert.match(await ask.text(), /Archive Garage before deleting it\./);
  assert.equal((await get(owner, `${pitsBase}/tracks/nope/delete`)).status, 404);
  assert.equal((await app.form(member, `${pitsBase}/tracks/nope`, { name: 'X' })).status, 404);
});

test('track forms from another site change nothing', async () => {
  const foreign = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };
  const before = tracks().length;
  const garage = trackNamed('Garage');
  for (const path of [`${pitsBase}/tracks`, `${pitsBase}/tracks/${garage.id}`, `${pitsBase}/tracks/${garage.id}/archive`, `${pitsBase}/track`]) {
    assert.equal((await app.form(owner, path, { name: 'Mallory' }, foreign)).status, 403, path);
  }
  assert.equal(tracks().length, before);
  assert.equal(trackNamed('Garage').name, 'Garage');
});

test('the setup page’s headings: the page, a plain h2 per section, an h3 within', async () => {
  const body = await (await get(owner, `${base}/setup`)).text();
  for (const id of ['track', 'drivers', 'transponders', 'decoders', 'watchers']) assert.match(body, new RegExp(`<h2 id="${id}-title">`), id);
  assert.doesNotMatch(body, /<h2 class="h3"/);
  assert.match(body, /<h3 class="track-subhead">Add a track<\/h3>/);
});

test('a track’s fold holds its two forms in one grid', async () => {
  const body = await (await get(owner, `${base}/setup`)).text();
  assert.match(body, /<details class="track-edit">\s*<summary>[^<]+<\/summary>\s*<div class="track-edit-forms">\s*<form method="post" action="[^"]+\/tracks\/[^"/]+" class="inline-form">[\s\S]*?<\/form>\s*<form method="post" action="[^"]+\/layout" class="inline-form" data-frame="off">[\s\S]*?<\/form>\s*<\/div>\s*<\/details>/);
});

test('a refused current track that names none keeps the current one selected, not the list’s first', async () => {
  await app.form(owner, `${base}/tracks`, { name: 'Aardvark loop' });
  const current = app.store.workspace(office.id).trackId;
  const bad = await app.form(owner, `${base}/track`, { id: 'nope', direction: 'cw' });
  assert.equal(bad.status, 404, 'no such track: the setup page again, with the error');
  const select = /<select id="current-track"[\s\S]*?<\/select>/.exec(await bad.text())[0];
  assert.match(select, new RegExp(`<option value="${current}" selected>`));
  assert.equal((select.match(/ selected>/g) ?? []).length, 1);
});

test('the watchers link’s field has its label for screen readers only; the heading says it', async () => {
  await app.form(owner, `${base}/watch-link`, {});
  const body = await (await get(owner, `${base}/setup`)).text();
  assert.match(body, /<label for="watch-link" class="visually-hidden">Watchers link<\/label>/);
});

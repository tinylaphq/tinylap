// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Against a running image: a layout goes in, and comes back as JSON and as
// a page. Self-contained, so CI can run it without installing anything.
const base = new URL(process.argv[2] ?? 'http://localhost:8080/');
const layout = { version: 2, unit: 'mat', room: null, pieces: [{ type: 'straight', x: 0, y: 0, rot: 0 }] };
const failures = [];
const expect = (ok, msg) => { if (!ok) failures.push(msg); };

const posted = await fetch(new URL('layouts', base), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(layout),
});
expect(posted.status === 201 || posted.status === 200, `POST /layouts -> ${posted.status}`);
const { key } = await posted.json();

const asJson = await fetch(new URL(`layouts/${key}`, base));
expect(asJson.headers.get('content-type') === 'application/json', `json content-type ${asJson.headers.get('content-type')}`);
expect(JSON.stringify(await asJson.json()) === JSON.stringify(layout), 'json round trip');

const asHtml = await fetch(new URL(`layouts/${key}`, base), { headers: { accept: 'text/html' } });
expect(/^text\/html/.test(asHtml.headers.get('content-type') ?? ''), `html content-type ${asHtml.headers.get('content-type')}`);
expect((await asHtml.text()).includes(`?layout=${key}`), 'page links back to the planner');

const doc = await fetch(new URL('openapi.json', base));
expect(doc.status === 200, `GET /openapi.json -> ${doc.status}`);

console.log(`api smoke: posted ${key}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

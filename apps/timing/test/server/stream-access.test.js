// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An open member stream checks its viewer's access again while it runs
// (#39). Access tokens here live a second, so every check refreshes them and
// sees memberships as accounts has them now.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { AuthError } from '@tinylap/auth';
import { removeMember } from '../../../accounts/server/workspaces.js';
import { startTiming } from './helpers.js';
import { events, next } from './sse.js';

let app;
let ana;
let office;

before(async () => {
  app = await startTiming({ env: { TINYLAP_ACCESS_TTL: '1' }, accessCheckMs: 50 });
  ana = await app.signUp('Ana');
  office = app.club(ana, 'Office');
});
after(() => app.close());

const STREAMS = [
  { name: 'board stream', path: () => `/clubs/${office.id}/board/events`, first: 'board', raw: true },
  { name: 'JSON live stream', path: () => `/workspaces/${office.id}/live`, first: 'snapshot', raw: false },
];

/** A new member of the office, signed in, with `stream` open. */
async function watching(stream, name) {
  const user = await app.signUp(name);
  app.join(ana, office.id, user);
  const who = await app.login(user);
  const res = await app.api(who, 'GET', stream.path());
  assert.equal(res.status, 200);
  const it = events(res, { raw: stream.raw });
  assert.ok(await next(it, stream.first));
  return { user, who, it };
}

for (const stream of STREAMS) {
  test(`the ${stream.name} ends when the member is removed from the club`, async () => {
    const { user, it } = await watching(stream, `Cy ${stream.name}`);
    removeMember(app.suite.accounts.db, ana.id, office.id, user.id);
    assert.equal(await next(it, 'ended'), null);
  });

  test(`the ${stream.name} ends when the member signs out`, async () => {
    const { who, it } = await watching(stream, `Dee ${stream.name}`);
    await app.api(who, 'POST', '/auth/logout');
    assert.equal(await next(it, 'ended'), null);
  });

  test(`the ${stream.name} stays open through an outage at the issuer`, async () => {
    const { it } = await watching(stream, `Fay ${stream.name}`);
    const session = app.auth.bff.session;
    let checks = 0;
    app.auth.bff.session = async () => {
      checks += 1;
      throw new AuthError('unavailable', 'down');
    };
    try {
      for (let waits = 0; checks < 3 && waits < 100; waits += 1) await new Promise((done) => setTimeout(done, 20));
    } finally {
      app.auth.bff.session = session;
    }
    assert.ok(checks >= 3);
    app.hub.publish(office.id, 'still-open', {});
    assert.ok(await next(it, stream.raw ? 'board' : 'still-open'));
    await it.return();
  });
}

// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An open member stream checks its viewer's access again while it runs
// (#39). In `app`, access tokens live a second, so every check refreshes them
// and sees memberships as accounts has them now. `tokens` keeps the default
// ten-minute token, so its streams check only when that refreshes; `polls`
// checks a minute apart, so only sign-out itself can end its streams in time.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { AuthError } from '@tinylap/auth';
import { removeMember } from '../../../accounts/server/workspaces.js';
import { startTiming } from './helpers.js';
import { events, next } from './sse.js';

/** A timing app with Ana's club, the office. @param {Record<string, any>} options */
async function withOffice(options) {
  const app = await startTiming(options);
  const ana = await app.signUp('Ana');
  return { app, ana, office: app.club(ana, 'Office') };
}

let app;
let ana;
let office;
let tokens;
let polls;

before(async () => {
  ({ app, ana, office } = await withOffice({ env: { TINYLAP_ACCESS_TTL: '1' }, accessCheckMs: 50 }));
  tokens = await withOffice({ accessCheckMs: 50 });
  polls = await withOffice({ accessCheckMs: 60_000 });
});
after(() => Promise.all([app, tokens.app, polls.app].map((a) => a.close())));

const STREAMS = [
  { name: 'board stream', path: (club) => `/clubs/${club.id}/board/events`, first: 'board', raw: true },
  { name: 'JSON live stream', path: (club) => `/workspaces/${club.id}/live`, first: 'snapshot', raw: false },
];

/** A new member of the office, signed in, with `stream` open. */
async function watching(stream, name, at = { app, ana, office }) {
  const user = await at.app.signUp(name);
  at.app.join(at.ana, at.office.id, user);
  const who = await at.app.login(user);
  const res = await at.app.api(who, 'GET', stream.path(at.office));
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

  test(`the ${stream.name} ends at once on sign-out`, async () => {
    const { who, it } = await watching(stream, `Gil ${stream.name}`, polls);
    await polls.app.api(who, 'POST', '/auth/logout');
    assert.equal(await next(it, 'ended'), null);
  });

  test(`the ${stream.name} checks again only when the token refreshes`, async () => {
    const { it } = await watching(stream, `Hal ${stream.name}`, tokens);
    const { bff } = tokens.app.auth;
    const session = bff.session;
    let calls = 0;
    bff.session = (...args) => {
      calls += 1;
      return session.apply(bff, args);
    };
    try {
      await new Promise((done) => setTimeout(done, 300));
    } finally {
      bff.session = session;
    }
    assert.equal(calls, 0);
    await it.return();
  });
}

test('logout with no open streams answers as before', async () => {
  const signOut = async (name, open) => {
    const user = await polls.app.signUp(name);
    polls.app.join(polls.ana, polls.office.id, user);
    const who = await polls.app.login(user);
    const res = await polls.app.api(who, 'GET', STREAMS[1].path(polls.office));
    const it = events(res);
    assert.ok(await next(it, 'snapshot'));
    if (!open) await it.return();
    const out = await polls.app.api(who, 'POST', '/auth/logout');
    if (open) assert.equal(await next(it, 'ended'), null);
    // The id token hint names the user; the rest of the way out is the same for everyone.
    const location = new URL(out.headers.get('location'));
    location.searchParams.delete('id_token_hint');
    return { status: out.status, location: String(location) };
  };
  const without = await signOut('Ivy', false);
  const withStream = await signOut('Jo', true);
  assert.deepEqual(withStream, without);
});

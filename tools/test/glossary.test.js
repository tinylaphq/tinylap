// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { BANNED, exempt, openapiStrings, proseLiterals, visibleText } from '../glossary.js';

const flagged = (text) => BANNED.test(exempt(text));
const texts = (source) => proseLiterals(source).map((l) => l.text);

test('BANNED matches every form of log in/out, workspace and publish', () => {
  for (const word of ['log in', 'logs in', 'logs out', 'log-in', 'logged in', 'logging in', 'logged-in', 'login', 'logout', 'workspace', 'Publish', 'Log out', 'Log-in is off', 'the logins', 'Publishing makes it public']) {
    assert.ok(BANNED.test(word), word);
  }
});

test('BANNED leaves words that only contain the letters alone', () => {
  for (const word of ['catalog in', 'dialog out', 'backlog in', 'blog out', 'publicly', 'Sign in', 'Sign-in', 'signed out']) {
    assert.ok(!BANNED.test(word), word);
  }
});

test('exempt removes the protocol names the decision allows', () => {
  assert.ok(!flagged('Go to /auth/login or /auth/logout'));
  assert.ok(!flagged('the __Host-tinylap-login cookie'));
  assert.ok(!flagged('Send ?login to start'));
  assert.ok(flagged('/auth/login, then log in'));
});

test('proseLiterals returns quoted, double-quoted and template prose with its line', () => {
  const source = "const a = 'Sign in to use the library.';\nconst b = \"Pick one of the drivers here.\";\nconst c = `Save this track to your library`;";
  assert.deepEqual(proseLiterals(source), [
    { line: 1, text: 'Sign in to use the library.' },
    { line: 2, text: 'Pick one of the drivers here.' },
    { line: 3, text: 'Save this track to your library' },
  ]);
});

test('proseLiterals skips literals that are not prose', () => {
  assert.deepEqual(texts("const a = 'workspace'; const b = '/workspaces/:id'; const c = 'a b';"), []);
});

test('proseLiterals finds "logs out" in prose', () => {
  const found = texts("const d = 'Ends the session and logs out at accounts too.';");
  assert.equal(found.length, 1);
  assert.ok(flagged(found[0]));
});

test('proseLiterals ignores comments', () => {
  assert.deepEqual(texts("// 'You must log in first'\n/* 'Every workspace you have' */\nconst a = 1;"), []);
});

test('proseLiterals blanks out ${…} in a template, since that is code', () => {
  const found = texts('const t = `Copied ${request.workspaceId} to the other club`;');
  assert.equal(found.length, 1);
  assert.ok(!flagged(found[0]));
  assert.match(found[0], /^Copied +to the other club$/);
});

test('proseLiterals still reads prose nested inside ${…}', () => {
  const found = texts("const t = `<p>${owner ? 'Every workspace you own' : ''}</p>`;");
  assert.ok(found.some(flagged));
});

test('proseLiterals reads an HTML template through visibleText', () => {
  const found = texts('const p = `<p>Back to <a href="/auth/login" data-workspace="${request.workspaceId}" class="accounts-workspace">the planner</a> now</p>`;');
  assert.equal(found.length, 1);
  assert.ok(!flagged(found[0]));
  assert.match(found[0], /Back to\s+the planner\s+now/);
  assert.ok(texts('const p = `<p>Log in again, <a href="/">here</a></p>`;').some(flagged));
});

test('proseLiterals keeps an aria-label inside an HTML template', () => {
  assert.ok(texts('const p = `<ul aria-label="Your workspace list"><li>x</li></ul>`;').some(flagged));
});

test('proseLiterals skips SQL', () => {
  const source = [
    "db.prepare('SELECT id FROM workspaces WHERE owner = ?');",
    "db.exec('SAVEPOINT workspaces');",
    "db.exec('RELEASE workspaces');",
    "const tables = ['track WHERE workspace_id', 'workspace WHERE id'];",
    'q(`DELETE FROM ${t} = ?`);',
  ].join('\n');
  assert.deepEqual(texts(source), []);
});

test('proseLiterals still flags prose with a lower-case "select" or "from"', () => {
  assert.ok(texts("const a = 'Select a workspace from the list';").some(flagged));
});

test('proseLiterals skips literals inside console calls', () => {
  const source = "console.error('log-in is off: no issuer set', detail('more about the workspace'));\nconst a = 'Sign in to use the library.';";
  assert.deepEqual(texts(source), ['Sign in to use the library.']);
});

test('proseLiterals keeps an apostrophe in a double-quoted string', () => {
  assert.deepEqual(texts(`const a = "Can't log in right now";`), ["Can't log in right now"]);
});

test('visibleText drops comments, scripts, styles and most attributes', () => {
  const html = '<!-- log in --><style>.workspace{}</style><script>login()</script><button value="publish" class="workspace" title="Share this track">Share</button><img alt="A track"><input placeholder="Your name"><a href="/auth/login" aria-label="Sign in">x</a>';
  const text = visibleText(html);
  assert.ok(!flagged(text), text);
  for (const kept of ['Share this track', 'Share', 'A track', 'Your name', 'Sign in']) assert.ok(text.includes(kept), kept);
});

test('visibleText decodes entities', () => {
  assert.match(visibleText('<h1>Can&#39;t sign in &amp; more</h1>'), /Can't sign in & more/);
});

test('openapiStrings collects every summary, description and title', () => {
  const doc = {
    info: { title: 'TinyLap Timing API', description: 'Lap timing.' },
    paths: { '/workspaces': { get: { summary: 'Your clubs', operationId: 'workspaces', responses: { 200: { description: 'OK' } } } } },
    components: { schemas: { A: { title: 'A thing', properties: { workspaceId: { type: 'string', description: 'The club' } } } } },
  };
  assert.deepEqual(openapiStrings(doc).sort(), ['A thing', 'Lap timing.', 'OK', 'The club', 'TinyLap Timing API', 'Your clubs']);
});

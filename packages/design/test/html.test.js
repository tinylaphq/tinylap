// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// The shared navbar markup: brand, lockup, the account menu and Sign in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { brand, brandLockup } from '../html/brand.js';
import { accountMenu, signInLink } from '../html/account.js';
import { escapeHtml, safeHref } from '../html/escape.js';
import { localTime } from '../html/local-time.js';

test('escapeHtml escapes the five characters HTML cares about; null and undefined are empty', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(null), '');
});

test('safeHref keeps http(s) and paths from here, and turns anything else into #', () => {
  for (const ok of ['https://a.example/x?y=1', 'http://127.0.0.1:9/', '/auth/logout', './pkg/design/mark.svg', '?big']) assert.equal(safeHref(ok), escapeHtml(ok), ok);
  for (const bad of ['/\\evil.example/x', '/\t/evil.example', '/\n/evil.example', 'javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', '//evil.example/', 'mailto:a@b', '', undefined]) assert.equal(safeHref(bad), '#', String(bad));
});

test('every URL field goes through safeHref', () => {
  const bad = 'javascript:alert(1)';
  assert.match(brand({ href: bad, name: 'x', markSrc: bad }), /href="#"><img src="#"/);
  assert.match(brandLockup({ name: 'x', markSrc: bad }), /src="#"/);
  const menu = accountMenu({ name: 'x', accountUrl: bad, signOutAction: bad, clubs: [{ href: bad, name: 'c' }] });
  assert.doesNotMatch(menu, /javascript:/);
  assert.equal(signInLink({ href: bad }), '<a class="btn btn-sm btn-outline nav-sign-in" href="#">Sign in</a>');
});

test('the brand links home with the mark; the lockup is the larger one', () => {
  assert.equal(brand({ href: '/', name: 'TinyLap <Timing>', markSrc: '/pkg/design/mark.svg' }),
    '<a class="navbar-brand" href="/"><img src="/pkg/design/mark.svg" alt="" width="24" height="24"> TinyLap &lt;Timing&gt;</a>');
  assert.equal(brandLockup({ name: 'TinyLap', markSrc: '/m.svg' }),
    '<p class="brand-lockup"><img src="/m.svg" alt="" width="32" height="32"><span class="brand">TinyLap</span></p>');
});

test('the account menu: tl-menu, one named details, the name after a hidden "Account:", Account, Sign out', () => {
  const out = accountMenu({ name: 'Ana <b>', accountUrl: 'https://acc/?a=1&b=2' });
  assert.match(out, /^<tl-menu class="nav-account">\s*<details class="navbar-menu" name="tl-account">\s*<summary><span class="visually-hidden">Account: <\/span><span class="nav-account-name">Ana &lt;b&gt;<\/span><\/summary>\s*<div class="nav-account-menu navbar-menu-panel">/);
  assert.match(out, /<a class="nav-account-link" href="https:\/\/acc\/\?a=1&amp;b=2">Account<\/a>/);
  assert.match(out, /<form method="post" action="\/auth\/logout">\s*<button type="submit" class="nav-account-signout">Sign out<\/button>\s*<\/form>/);
  assert.doesNotMatch(out, /\bid=/, 'no ids, so two menus never collide');
  assert.match(out, /<\/details>\s*<\/tl-menu>$/);
});

test('your clubs: absent for none, else a named list with Personal first and the current one marked', () => {
  for (const clubs of [null, []]) assert.doesNotMatch(accountMenu({ name: 'Ana', accountUrl: '/', clubs }), /Your clubs/);
  const out = accountMenu({ name: 'Ana', accountUrl: '/', clubs: [{ href: '/personal/board', name: 'Personal' }, { href: '/clubs/1/board', name: 'Office & Co', current: true }] });
  assert.match(out, /<p class="navbar-menu-label" aria-hidden="true">Your clubs<\/p>\s*<ul aria-label="Your clubs">\s*<li><a href="\/personal\/board">Personal<\/a><\/li>\s*<li><a href="\/clubs\/1\/board" aria-current="true">Office &amp; Co<\/a><\/li>\s*<\/ul>/);
});

test('extra items are buttons with the caller’s id, hidden when asked; a custom sign-out action', () => {
  const out = accountMenu({ name: 'Ana', accountUrl: '/', items: [{ id: 'menu-library', label: 'Library', hidden: true }], signOutAction: '/out' });
  assert.match(out, /<button type="button" class="nav-account-item" id="menu-library" hidden>Library<\/button>/);
  assert.match(out, /action="\/out"/);
});

test('localTime writes the instant with its UTC text as the fallback', () => {
  const at = Date.UTC(2026, 9, 2, 7, 5);
  assert.equal(localTime(at, 'time'), '<tl-local-time format="time"><time datetime="2026-10-02T07:05:00.000Z">07:05</time></tl-local-time>');
  assert.match(localTime(at, 'date'), /format="date"><time [^>]*>2 Oct<\/time>/);
  assert.match(localTime(at, 'datetime'), /format="datetime"><time [^>]*>2 Oct, 07:05<\/time>/);
});

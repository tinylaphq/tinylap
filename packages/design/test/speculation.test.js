// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

// The speculation rules every TinyLap page carries, and the CSP hash that lets them run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SPECULATION_HASH, SPECULATION_RULES } from '../html/speculation.js';

test('the rules prefetch same-site links on intent, never the sign-in flow or the APIs', () => {
  const json = /^<script type="speculationrules">(.*)<\/script>$/s.exec(SPECULATION_RULES)?.[1];
  assert.ok(json, 'one inline speculationrules script');
  const { prefetch, prerender } = JSON.parse(json);
  assert.equal(prerender, undefined, 'prefetch only: a prerendered page would run its scripts and open streams');
  assert.equal(prefetch.length, 1);
  assert.equal(prefetch[0].eagerness, 'moderate');
  const text = JSON.stringify(prefetch[0].where);
  for (const path of ['/auth/*', '/oauth2/*', '/api/*']) assert.ok(text.includes(path), path);
});

test('the hash is the script body’s sha256, as CSP wants it', () => {
  const body = SPECULATION_RULES.replace(/^<script type="speculationrules">/, '').replace(/<\/script>$/, '');
  assert.equal(SPECULATION_HASH, `sha256-${createHash('sha256').update(body).digest('base64')}`);
});

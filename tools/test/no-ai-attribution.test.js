// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { commitFindings, findings } from '../no-ai-attribution.js';

const own = { sha: 'a'.repeat(40), author: 'Ana <ana@example.org>', committer: 'GitHub <noreply@github.com>', message: 'fix: a thing\n\nSigned-off-by: Ana <ana@example.org>' };

test('a person\'s own commit passes', () => {
  assert.deepEqual(commitFindings([own]), []);
});

test('an AI identity as author, committer or sign-off is found', () => {
  const ai = 'Claude <noreply@anthropic.com>';
  assert.deepEqual(commitFindings([{ ...own, author: ai }]), ['aaaaaaa author: an Anthropic address']);
  assert.deepEqual(commitFindings([{ ...own, committer: ai }]), ['aaaaaaa committer: an Anthropic address']);
  assert.deepEqual(commitFindings([{ ...own, message: `fix: x\n\nSigned-off-by: ${ai}` }]), [
    'aaaaaaa message: an Anthropic address',
    'aaaaaaa message: a sign-off by an AI identity',
  ]);
});

test('AI trailers and lines are found, in any case', () => {
  assert.deepEqual(findings('t', 'fix: x\n\nco-authored-by: Claude Opus <x@example.org>'), ['t: an AI co-author trailer']);
  assert.deepEqual(findings('t', 'Body\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)'), ['t: a "Generated with Claude Code" line']);
  assert.deepEqual(findings('t', 'See https://claude.ai/code/session_0123'), ['t: a link to a Claude Code session']);
});

test('naming Claude as a client the code supports is not attribution', () => {
  assert.deepEqual(findings('t', 'feat: what real MCP clients need, checked against Claude and the client SDK'), []);
  assert.deepEqual(findings('t', 'Co-authored-by: Ana <ana@example.org>'), []);
  assert.deepEqual(findings('t', '- It fails on a "Generated with Claude Code" line.'), [], 'a sentence about the footer');
  assert.deepEqual(findings('t', 'Body\n\nGenerated with Claude Code'), ['t: a "Generated with Claude Code" line']);
});

// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the confirm dialog asks with the filled danger button: what it confirms cannot be taken back', () => {
  assert.match(page, /<button class="btn btn-danger-fill" value="confirm" id="confirm-dialog-ok">/);
});

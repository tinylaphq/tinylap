// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The glossary guard every app's tests share: what people read says "sign in"
// and "sign out", "club" and "personal", and "share", never "log in",
// "workspace" or "publish". These helpers pull the words people read out of
// JavaScript sources, HTML and OpenAPI documents, so a test can hold them
// against BANNED.

import { stripComments } from './js-source.js';

export const BANNED = /\blog(?:s|ged|ging)?[ -]?(?:in|out)\b|\blog(?:in|out)s?\b|workspace|\bpublish/i;

// Names of protocol things that keep their own spelling.
const PROTOCOL = /\/auth\/log(?:in|out)\b|__Host-tinylap-login|\?login\b/g;

export function exempt(text) {
  return text.replace(PROTOCOL, ' ');
}

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|VALUES|SAVEPOINT|RELEASE|ROLLBACK|BEGIN|COMMIT|CREATE|ALTER|DROP|PRAGMA|WITH)\b/;
const KEPT_ATTRIBUTES = /\s(?:aria-label|title|placeholder|alt)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

// The text a browser shows for some HTML, plus the attributes people read or
// hear: aria-label, title, placeholder and alt. Other attributes (href, value,
// class, data-*) are code and are dropped.
export function visibleText(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, ' ')
    .replace(/<style\b[\s\S]*?(?:<\/style>|$)/gi, ' ');
  const text = stripped.replace(/<[^>]*>?/g, (tag) => {
    const kept = [...tag.matchAll(KEPT_ATTRIBUTES)].map((m) => m[1] ?? m[2]);
    return ` ${kept.join(' ')} `;
  });
  return decode(text);
}

// Every literal in a source: { text, line, consoleCall }. Inside a template,
// each ${…} becomes a space, and the literals inside it are read too.
function literals(source) {
  const found = [];
  let i = 0;
  let depth = 0;
  const consoleDepths = [];

  const lineAt = (index) => source.slice(0, index).split('\n').length;

  // Reads a template literal starting after its backtick; returns the index
  // after the closing backtick.
  function template(start, inConsole) {
    let j = start;
    let text = '';
    while (j < source.length && source[j] !== '`') {
      if (source[j] === '\\') {
        text += source.slice(j, j + 2);
        j += 2;
      } else if (source[j] === '$' && source[j + 1] === '{') {
        text += ' ';
        j = code(j + 2, inConsole, 1);
      } else {
        text += source[j];
        j++;
      }
    }
    found.push({ text, line: lineAt(start - 1), consoleCall: inConsole });
    return j + 1;
  }

  // Reads code until the brace that closes `open` levels; returns the index
  // after that brace (or the end of the source).
  function code(start, inConsole, open) {
    let j = start;
    let braces = open;
    while (j < source.length) {
      const c = source[j];
      if (c === '{') braces++;
      else if (c === '}' && --braces === 0) return j + 1;
      if (c === '`') {
        j = template(j + 1, inConsole);
      } else if (c === "'" || c === '"') {
        j = quoted(j, inConsole);
      } else {
        j++;
      }
    }
    return j;
  }

  // Reads a '…' or "…" string starting at its quote; returns the index after
  // it. A newline before the closing quote means this was no string (a quote
  // in a regex literal, say), so only the quote itself is skipped.
  function quoted(start, inConsole) {
    const q = source[start];
    let j = start + 1;
    while (j < source.length && source[j] !== q && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
    if (source[j] !== q) return start + 1;
    found.push({ text: source.slice(start + 1, j), line: lineAt(start), consoleCall: inConsole });
    return j + 1;
  }

  while (i < source.length) {
    const c = source[i];
    const inConsole = consoleDepths.length > 0;
    if (c === "'" || c === '"') {
      i = quoted(i, inConsole);
    } else if (c === '`') {
      i = template(i + 1, inConsole);
    } else if (c === '(') {
      depth++;
      i++;
    } else if (c === ')') {
      if (consoleDepths.at(-1) === depth) consoleDepths.pop();
      depth--;
      i++;
    } else {
      const call = /^console\.\w+\s*\(/.exec(source.slice(i, i + 40));
      if (call && !/[\w$.]/.test(source[i - 1] ?? '')) {
        depth++;
        consoleDepths.push(depth);
        i += call[0].length;
      } else {
        i++;
      }
    }
  }
  return found;
}

// The string literals in a JavaScript source that read as prose, with their
// line numbers. Comments, SQL and console.* output are left out, and HTML in
// a literal counts only for its visible text.
export function proseLiterals(source) {
  return literals(stripComments(source))
    .filter((l) => !l.consoleCall && !SQL.test(l.text))
    .map((l) => ({ line: l.line, text: l.text.includes('<') ? visibleText(l.text) : l.text }))
    .filter((l) => {
      // Prose, or a short label: "Sign out", "Publish", "Log In". A template's
      // text counts with its ${…} parts already blanked out.
      const text = l.text.trim();
      return /[A-Za-z]{2,}\s+[A-Za-z]/.test(text) || /^[A-Z][a-z]+(?: [A-Za-z]+)*$/.test(text);
    });
}

// Every summary, description and title in an OpenAPI document.
export function openapiStrings(doc) {
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' && (key === 'summary' || key === 'description' || key === 'title')) out.push(value);
        else walk(value);
      }
    }
  };
  walk(doc);
  return out;
}

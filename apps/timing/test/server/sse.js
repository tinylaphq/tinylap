// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reads a text/event-stream response as { id, type, data } events. Data
 * lines are joined with "\n"; `raw` keeps them as text instead of JSON.
 * @param {Response} res @param {{ raw?: boolean }} [options]
 */
export async function* events(res, { raw = false } = {}) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let id = null;
        let type = null;
        const data = [];
        for (const line of block.split('\n')) {
          if (!line || line.startsWith(':')) continue;
          const colon = line.indexOf(':');
          const key = line.slice(0, colon);
          const val = line.slice(colon + 1).replace(/^ /, '');
          if (key === 'id') id = Number(val);
          else if (key === 'event') type = val;
          else if (key === 'data') data.push(val);
        }
        if (type) yield { id, type, data: raw ? data.join('\n') : JSON.parse(data.join('\n')) };
      }
    }
  } finally {
    // `it.return()` ends the stream from the client side.
    await reader.cancel().catch(() => {});
  }
}

/** The next event of `type`, skipping others. */
export async function next(iterator, type) {
  for (;;) {
    const { value, done } = await iterator.next();
    if (done) return null;
    if (!type || value.type === type) return value;
  }
}

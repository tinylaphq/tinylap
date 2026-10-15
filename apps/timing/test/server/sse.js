// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Reads a text/event-stream response as { id, type, data } events. @param {Response} res */
export async function* events(res) {
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
        const fields = {};
        for (const line of block.split('\n')) {
          if (!line || line.startsWith(':')) continue;
          const colon = line.indexOf(':');
          fields[line.slice(0, colon)] = line.slice(colon + 1).trimStart();
        }
        if (fields.event) yield { id: Number(fields.id), type: fields.event, data: JSON.parse(fields.data) };
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

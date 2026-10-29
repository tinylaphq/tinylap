// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, createReader, createSimulator } from '@tinylap/timing';
import { Bridge, WifiRefusedError, WifiUnconfirmedError, sendOutbox } from '../public/bridge.js';
import { memoryOutbox } from '../public/outbox.js';

/** A serial port whose other end is `sim` (or silence). */
function fakePort(sim) {
  let controller;
  const reader = createReader();
  const port = {
    readable: new ReadableStream({ start(c) { controller = c; } }),
    writable: new WritableStream({
      write(chunk) {
        if (!sim) return;
        for (const message of reader.push(new TextDecoder().decode(chunk))) {
          for (const line of sim.reply(message, 0)) controller.enqueue(new TextEncoder().encode(line));
        }
      },
    }),
    open: async () => {},
    close: async () => {},
  };
  return { port, send: (line) => controller.enqueue(new TextEncoder().encode(line)), end: () => controller.close() };
}

const until = async (fn) => {
  for (let i = 0; i < 200; i += 1) {
    if (await fn()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error('timed out');
};

/** A post that answers `through` for the passings it got (null for none), and records each batch, logs included. */
function posting() {
  const posts = [];
  return { posts, post: async (decoder, batch) => { posts.push({ decoder, ...batch }); return { through: batch.passings.length ? Math.max(...batch.passings.map((x) => x.t)) : null }; } };
}

test('an unpaired decoder is paired, then forwards passings', async () => {
  const sim = createSimulator({ cars: [] });
  const { port, send } = fakePort(sim);
  const posts = [];
  const outbox = memoryOutbox();
  const bridge = new Bridge({ port, outbox, post: async (decoder, batch) => { posts.push({ decoder, batch }); return { through: Math.max(...batch.passings.map((x) => x.t)) }; } });
  await bridge.start();
  await until(() => bridge.state === 'unpaired');
  await bridge.pair('dec_1', 't'.repeat(43), { ssid: 'Office', password: 'secret12' });
  await until(() => bridge.state === 'ready');
  assert.equal(sim.decoder, 'dec_1');
  assert.equal(bridge.decoder, 'dec_1');

  const seen = [];
  bridge.addEventListener('passing', (event) => seen.push(event.detail));
  send(commands.lap('0A', 1000));
  send(commands.lap('0A', 9000));
  await until(async () => (await outbox.count()) === 0 && posts.length > 0 && seen.length === 2);
  assert.deepEqual(seen.map((x) => x.lapMs), [null, 8000], 'the local preview computes laps');
  assert.deepEqual(posts.flatMap((x) => x.batch.passings.map((y) => y.t)).sort((a, b) => a - b), [1000, 9000]);
  assert.ok(posts.every((x) => x.decoder === 'dec_1' && x.batch.boot === sim.boot));
  await bridge.close();
});

test('offline, passings wait in the outbox and go when the server is back', async () => {
  const sim = createSimulator({ cars: [], decoder: 'dec_1' });
  const { port, send } = fakePort(sim);
  let down = true;
  const outbox = memoryOutbox();
  const bridge = new Bridge({ port, outbox, retryMs: 10_000, post: async (_decoder, batch) => {
    if (down) throw new Error('offline');
    return { through: Math.max(...batch.passings.map((x) => x.t)) };
  } });
  await bridge.start();
  await until(() => bridge.state === 'ready');
  send(commands.lap('0A', 1000));
  await until(() => bridge.online === false);
  assert.equal(await outbox.count(), 1);
  assert.equal(bridge.lastError.message, 'offline');
  down = false;
  await bridge.flush();
  assert.equal(await outbox.count(), 0);
  assert.equal(bridge.online, true);
  await bridge.close();
});

test('a device that says nothing is listening, not an error; a lost port is disconnected', async () => {
  const silent = fakePort(null);
  const bridge = new Bridge({ port: silent.port, outbox: memoryOutbox(), post: async () => ({ through: null }), handshakeMs: 20 });
  await bridge.start();
  await until(() => bridge.state === 'listening');
  assert.equal(bridge.lastError, null);
  silent.end();
  await until(() => bridge.state === 'disconnected');
});

test('a group the server refuses for good is dropped and does not block the others', async () => {
  const outbox = memoryOutbox();
  await outbox.add({ decoder: 'd1', boot: 'b1', transponder: '0A', t: 1 });
  await outbox.add({ decoder: 'd2', boot: 'b2', transponder: '0B', t: 2 });
  const posted = [];
  const bridge = new Bridge({ port: fakePort(null).port, outbox, retryMs: 10_000, post: async (decoder, batch) => {
    if (decoder === 'd1') throw Object.assign(new Error('no'), { status: 404 });
    posted.push(decoder);
    return { through: batch.passings.at(-1).t };
  } });
  await bridge.flush();
  assert.deepEqual(posted, ['d2']);
  assert.equal(await outbox.count(), 0, 'a refused passing does not wait forever');
  assert.equal(bridge.lastError.message, 'no');
  assert.equal(bridge.dropped, 1);
  await bridge.close();
});

const p = (t, decoder = 'd1') => ({ decoder, boot: 'b1', transponder: '0A', t });
const failing = (status, message = `answered ${status}`) => Object.assign(new Error(message), { status });

test('only a 404 or a 422 drops the passings: they will never be taken', async () => {
  for (const status of [404, 422]) {
    const outbox = memoryOutbox();
    for (const t of [1000, 2000, 3000]) await outbox.add(p(t));
    await outbox.add(p(500, 'd2'));
    const refused = await sendOutbox(outbox, async (decoder, batch) => {
      if (decoder === 'd1') throw failing(status, 'There is no such decoder.');
      return { through: batch.passings.at(-1).t };
    });
    assert.equal(refused.refusal.message, 'There is no such decoder.');
    assert.equal(refused.dropped, 3, String(status));
    assert.equal(await outbox.count(), 0, String(status));
  }
});

test('signed out, too large, rate limited, a 5xx or the network: the passings wait for a retry', async () => {
  const outbox = memoryOutbox();
  for (const failure of [new Error('offline'), failing(401), failing(413), failing(415), failing(429), failing(500), failing(503)]) {
    await outbox.add(p(1000));
    await assert.rejects(sendOutbox(outbox, async () => { throw failure; }), failure);
    assert.equal(await outbox.count(), 1, failure.message);
    await outbox.remove([p(1000)]);
  }
  assert.deepEqual(await sendOutbox(outbox, async () => ({ through: null })), { refusal: null, dropped: 0, forbidden: null, blocked: 0, sentLines: [] });
});

test('a decoder of a club without access waits, and does not hold up the others', async () => {
  const outbox = memoryOutbox();
  await outbox.add(p(1, 'a-other-club'));
  await outbox.add(p(2, 'a-other-club'));
  const posted = [];
  const post = async (decoder, batch) => {
    posted.push(decoder);
    if (decoder === 'a-other-club') throw failing(403, 'This decoder is not paired in one of your clubs or your personal space.');
    return { through: batch.passings.at(-1).t };
  };
  for (const t of [10, 20, 30]) {
    await outbox.add(p(t, 'z-mine'));
    const sent = await sendOutbox(outbox, post);
    assert.equal(sent.blocked, 2, 'the other club\'s passings are counted');
    assert.equal(sent.forbidden.status, 403);
    assert.deepEqual(sent.dropped, 0);
    assert.deepEqual((await outbox.list()).map((x) => x.decoder), ['a-other-club', 'a-other-club'], `flush at ${t}: mine went, theirs wait`);
  }
  assert.equal(posted.filter((d) => d === 'z-mine').length, 3, 'every flush sends mine');
});

test('signed out stops the flush at once and keeps everything', async () => {
  const outbox = memoryOutbox();
  await outbox.add(p(1, 'a'));
  await outbox.add(p(2, 'b'));
  const posted = [];
  await assert.rejects(sendOutbox(outbox, async (decoder) => { posted.push(decoder); throw failing(401); }), { status: 401 });
  assert.deepEqual(posted, ['a'], 'every group would fail the same way');
  assert.equal(await outbox.count(), 2);
});

test('the bridge is online and counts what waits for a club without access', async () => {
  const outbox = memoryOutbox();
  await outbox.add(p(1, 'a-other-club'));
  await outbox.add(p(2, 'z-mine'));
  const bridge = new Bridge({ port: fakePort(null).port, outbox, retryMs: 10_000, post: async (decoder, batch) => {
    if (decoder === 'a-other-club') throw failing(403, 'no access');
    return { through: batch.passings.at(-1).t };
  } });
  await bridge.flush();
  assert.equal(bridge.online, true);
  assert.equal(bridge.blocked, 1);
  assert.equal(bridge.lastError, null, 'nothing was refused for good');
  assert.deepEqual((await outbox.list()).map((x) => x.decoder), ['a-other-club']);
  await bridge.close();
});

test('a failure after a drop still reports the drop', async () => {
  const outbox = memoryOutbox();
  await outbox.add(p(1000, 'd1'));
  await outbox.add(p(2000, 'd2'));
  const offline = new Error('offline');
  await assert.rejects(sendOutbox(outbox, async (decoder) => { throw decoder === 'd1' ? failing(404, 'gone') : offline; }), (error) => {
    assert.equal(error, offline);
    assert.equal(error.dropped, 1);
    assert.equal(error.refusal.message, 'gone');
    return true;
  });
  assert.deepEqual((await outbox.list()).map((x) => x.decoder), ['d2']);
});

test('a drop after an outage is an answer: the bridge is online again and says the outbox changed', async () => {
  const outbox = memoryOutbox();
  await outbox.add(p(1000));
  let down = true;
  const bridge = new Bridge({ port: fakePort(null).port, outbox, retryMs: 10_000, post: async () => {
    throw down ? new Error('offline') : failing(404, 'gone');
  } });
  await bridge.flush();
  assert.equal(bridge.online, false);
  down = false;
  let changes = 0;
  bridge.addEventListener('outbox', () => { changes += 1; });
  await bridge.flush();
  assert.equal(bridge.online, true);
  assert.equal(bridge.dropped, 1);
  assert.equal(bridge.lastError.message, 'gone');
  assert.ok(changes >= 1);
  assert.equal(await outbox.count(), 0);
  await bridge.close();
});

test('a decoder that reboots with the port open is asked again who it is', async () => {
  const sim = createSimulator({ cars: [], decoder: 'dec_1' });
  const { port, send } = fakePort(sim);
  const bridge = new Bridge({ port, outbox: memoryOutbox(), post: async () => ({ through: null }) });
  await bridge.start();
  await until(() => bridge.state === 'ready');
  const before = bridge.boot;
  send(commands.clock(5000));
  send(commands.clock(9000));
  sim.reply({ type: 'reset' }, 9000); // the reset's own %TLID got lost on the cable
  send(commands.clock(100));
  await until(() => bridge.state === 'ready' && bridge.boot === sim.boot);
  assert.notEqual(bridge.boot, before);
  await bridge.close();
});

test('a reply that came too late does not answer the next request', async () => {
  const { port, send } = fakePort(null);
  const bridge = new Bridge({ port, outbox: memoryOutbox(), post: async () => ({ through: null }), helloMs: 10_000, replyMs: 30 });
  await bridge.start();
  await assert.rejects(bridge.pair('dec_1', 't'.repeat(43)), /didn't answer/);
  const second = bridge.pair('dec_1', 't'.repeat(43));
  send(commands.ok);
  await second;
  await bridge.close();
});

test('a decoder that refuses Wi-Fi after %TLOK& for the pairing ends ready, and pair rejects with the refusal', async () => {
  // The simulated decoder answers %TLOK& to %TLPAIR, and %TLERR Wi-Fi password length& to a 7-byte password.
  const sim = createSimulator({ cars: [] });
  const { port } = fakePort(sim);
  const bridge = new Bridge({ port, outbox: memoryOutbox(), post: async () => ({ through: null }) });
  await bridge.start();
  await until(() => bridge.state === 'unpaired');
  await assert.rejects(bridge.pair('dec_1', 't'.repeat(43), { ssid: 'Office', password: 'short12' }),
    (e) => e instanceof WifiRefusedError && e.name === 'WifiRefusedError' && e.reason === 'Wi-Fi password length');
  await until(() => bridge.state === 'ready');
  assert.equal(bridge.decoder, 'dec_1');
  await bridge.close();
});

test('a Wi-Fi timeout after %TLOK& ends ready, and pair rejects with WifiUnconfirmedError', async () => {
  // A decoder that never answers %TLWIFI.
  const sim = createSimulator({ cars: [] });
  const silent = { reply: (message, now) => (message.type === 'wifi' ? [] : sim.reply(message, now)) };
  const { port } = fakePort(silent);
  const bridge = new Bridge({ port, outbox: memoryOutbox(), post: async () => ({ through: null }), replyMs: 50 });
  await bridge.start();
  await until(() => bridge.state === 'unpaired');
  await assert.rejects(bridge.pair('dec_1', 't'.repeat(43), { ssid: 'Office', password: 'secret12' }),
    (e) => e instanceof WifiUnconfirmedError && e.name === 'WifiUnconfirmedError');
  await until(() => bridge.state === 'ready');
  assert.equal(bridge.decoder, 'dec_1');
  await bridge.close();
});

test('sending drops only the passings a batch carried, up to `through`', async () => {
  const outbox = memoryOutbox();
  const p = (t) => ({ decoder: 'd1', boot: 'b1', transponder: '0A', t });
  await outbox.add(p(1000));
  await outbox.add(p(9000));
  const posted = [];
  await sendOutbox(outbox, async (_decoder, batch) => {
    posted.push(batch.passings.map((x) => x.t));
    // The cable reads an older passing while the Wi-Fi copy already put 9000 on the server.
    if (posted.length === 1) await outbox.add(p(5000));
    return { through: 9000 };
  });
  assert.deepEqual(posted, [[1000, 9000], [5000]]);
  assert.equal(await outbox.count(), 0);
});

test('a closed bridge sends nothing more, and arms no retry', async () => {
  const { port } = fakePort(null);
  const outbox = memoryOutbox();
  await outbox.add({ decoder: 'd1', boot: 'b00tb00t', transponder: '0A', t: 1000 });
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const bridge = new Bridge({ port, outbox, retryMs: 20, post: async () => { calls += 1; await gate; throw new Error('offline'); } });
  const flushing = bridge.flush();
  await until(() => calls === 1);
  await bridge.close();
  release();
  await flushing;
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(calls, 1, 'no retry after close');
  await bridge.flush();
  assert.equal(calls, 1, 'no flush after close');
});

// %TLLOG lines (spec §2.4, §2.6).

const log = (line) => `%TLLOG ${line}&`;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
/** A paired TinyLap decoder, ready. `post` defaults to posting()'s. */
async function ready(t, options = {}) {
  const sim = createSimulator({ cars: [], decoder: 'dec_1' });
  const { port, send, end } = fakePort(sim);
  const { posts, post } = posting();
  const outbox = memoryOutbox();
  const bridge = new Bridge({ port, outbox, post, retryMs: 10_000, ...options });
  // Closed even when an assertion fails, so its timers can't keep the test process alive.
  t.after(() => bridge.close());
  await bridge.start();
  await until(() => bridge.state === 'ready');
  return { sim, send, end, posts, outbox, bridge };
}

test('lines go with the next batch of passings for their boot', async (t) => {
  const { sim, send, posts, outbox, bridge } = await ready(t, { logMaxWaitMs: 100 });
  send(log('stat up=1'));
  send(commands.lap('0A', 1000));
  await until(async () => posts.length === 1 && (await outbox.count()) === 0);
  await wait(200);
  assert.deepEqual(posts, [{ decoder: 'dec_1', boot: sim.boot, passings: [{ transponder: '0A', t: 1000 }], logs: ['stat up=1'] }]);
  await bridge.close();
});

test('a pass line rides on the next passing\'s batch, not a post of its own', async (t) => {
  const { send, posts, bridge } = await ready(t, { logMaxWaitMs: 100 });
  send(commands.lap('0A', 1000));
  await until(() => posts.length === 1);
  send(log('pass id=0A t=3E8'));
  send(commands.lap('0A', 9000));
  await until(() => posts.length === 2);
  await wait(200);
  assert.equal(posts.length, 2);
  assert.ok(posts.every((x) => x.passings.length > 0));
  assert.equal(posts[0].logs, undefined, 'no logs key without lines');
  assert.deepEqual(posts[1].logs, ['pass id=0A t=3E8']);
  await bridge.close();
});

test('with no passings, one logs-only batch after logMaxWaitMs; a second line does not restart the timer', async (t) => {
  const logMaxWaitMs = 300;
  const { posts, post } = posting();
  let postedAt = null;
  const { sim, send, bridge } = await ready(t, { logMaxWaitMs, post: async (decoder, batch) => {
    postedAt ??= performance.now();
    return post(decoder, batch);
  } });
  send(log('stat up=1'));
  await wait(200);
  const second = performance.now();
  send(log('stat up=2'));
  await until(() => posts.length === 1);
  // A timer restarted by the second line could fire no sooner than logMaxWaitMs after it; the first line's fires about
  // 100 ms after it, and only sooner if the wait above ran late.
  assert.ok(postedAt - second < logMaxWaitMs - 10, 'the timer was not restarted by the second line');
  assert.deepEqual(posts, [{ decoder: 'dec_1', boot: sim.boot, passings: [], logs: ['stat up=1', 'stat up=2'] }]);
  await wait(logMaxWaitMs + 50);
  assert.equal(posts.length, 1);
  await bridge.close();
});

test('a passing stamped while a flush runs goes with the rerun, though the log timer asked for a flush too', async (t) => {
  const inner = memoryOutbox();
  // The flush's last list() is held, so the second passing is stamped after it: only the rerun can post it.
  let listGate = null;
  let listing = false;
  const outbox = { ...inner, list: async () => {
    const items = await inner.list();
    if (listGate) {
      listing = true;
      await listGate;
    }
    return items;
  } };
  let releasePost;
  const postGate = new Promise((done) => { releasePost = done; });
  const { posts, post } = posting();
  const { send, bridge } = await ready(t, { outbox, logMaxWaitMs: 30, post: async (decoder, batch) => {
    await postGate;
    return post(decoder, batch);
  } });
  const seen = [];
  bridge.addEventListener('passing', (event) => seen.push(event.detail.t));
  send(log('stat up=1'));
  send(commands.lap('0A', 1000));
  await until(() => seen.length === 1);
  // The log timer fires while the passing's post, which carries the line, is held.
  await wait(80);
  let releaseList;
  listGate = new Promise((done) => { releaseList = done; });
  releasePost();
  await until(() => listing);
  send(commands.lap('0A', 9000));
  await until(async () => seen.length === 2 && (await inner.count()) === 1);
  listGate = null;
  releaseList();
  await until(() => posts.some((x) => x.passings.some((p) => p.t === 9000)));
  assert.deepEqual(posts.map((x) => x.passings.map((p) => p.t)), [[1000], [9000]]);
  assert.deepEqual(posts[0].logs, ['stat up=1']);
  await bridge.close();
});

test('at most 64 lines per batch', async (t) => {
  const { send, posts, bridge } = await ready(t, { logMaxWaitMs: 50 });
  const lines = Array.from({ length: 70 }, (_, i) => `stat n=${i}`);
  for (const line of lines) send(log(line));
  await until(() => posts.length === 2);
  assert.deepEqual(posts.map((x) => x.logs.length), [64, 6]);
  assert.deepEqual(posts.flatMap((x) => x.logs), lines);
  await bridge.close();
});

test('lines of an earlier boot go logs-only, not with the new boot', async (t) => {
  const { sim, send, posts, bridge } = await ready(t, { logMaxWaitMs: 100 });
  const first = sim.boot;
  send(log('stat up=1'));
  send('%TLID dec_1 b00tb00t&');
  send(commands.lap('0A', 1000));
  await until(() => posts.length === 2);
  assert.deepEqual(posts, [
    { decoder: 'dec_1', boot: 'b00tb00t', passings: [{ transponder: '0A', t: 1000 }] },
    { decoder: 'dec_1', boot: first, passings: [], logs: ['stat up=1'] },
  ]);
  await bridge.close();
});

test('lines are dropped on 401, 403, 404, 413 and 422, and kept on 429, 5xx and network errors', async () => {
  const line = { decoder: 'd1', boot: 'b1', line: 'stat up=1' };
  for (const [make, kept] of [[() => failing(401), false], [() => failing(403), false], [() => failing(404), false], [() => failing(413), false],
    [() => failing(422), false], [() => failing(429), true], [() => failing(500), true], [() => failing(503), true], [() => new Error('offline'), true]]) {
    for (const alone of [false, true]) {
      const outbox = memoryOutbox();
      if (!alone) await outbox.add(p(1000));
      const carried = [];
      const failure = make();
      const result = await sendOutbox(outbox, async (_decoder, batch) => { carried.push(batch); throw failure; }, () => {}, { lines: [line], alone })
        .catch((error) => error);
      const label = `${failure.message}, ${alone ? 'logs-only' : 'with passings'}`;
      assert.deepEqual(carried[0].logs, ['stat up=1'], label);
      assert.deepEqual(result.sentLines, kept ? [] : [line], label);
      if (alone) assert.notEqual(result, failure, `a logs-only answer never throws: ${label}`);
    }
  }
});

test('a thrown error\'s sentLines are not sent again', async (t) => {
  let down = () => true;
  const taken = [];
  const { send, outbox, bridge } = await ready(t, { post: async (decoder, batch) => {
    if (down(batch.boot)) throw failing(500);
    taken.push(batch.logs);
    return { through: Math.max(...batch.passings.map((x) => x.t)) };
  } });
  send(log('stat a=1'));
  send(commands.lap('0A', 1000));
  await until(() => bridge.online === false);
  send('%TLID dec_1 b00tb00t&');
  send(log('stat b=1'));
  send(commands.lap('0A', 2000));
  await until(async () => (await outbox.count()) === 2);
  down = (boot) => boot === 'b00tb00t';
  await bridge.flush();
  assert.deepEqual(taken, [['stat a=1']]);
  down = () => false;
  await bridge.flush();
  assert.deepEqual(taken, [['stat a=1'], ['stat b=1']], 'the first group\'s line went once');
  await bridge.close();
});

test('a logs-only 422 or 5xx sets no refusal, dropped, blocked or lastError, and leaves online alone', async (t) => {
  for (const status of [422, 500]) {
    let posted = 0;
    const { send, bridge } = await ready(t, { logMaxWaitMs: 30, post: async () => { posted += 1; throw failing(status); } });
    let changes = 0;
    bridge.addEventListener('online', () => { changes += 1; });
    send(log('stat up=1'));
    await until(() => posted >= 1);
    await wait(20);
    assert.deepEqual([bridge.lastError, bridge.dropped, bridge.blocked, bridge.online, changes], [null, 0, 0, true, 0], String(status));
    await bridge.close();
  }
});

test('a logs-only answer with through null drops the lines', async (t) => {
  const { send, posts, bridge } = await ready(t, { logMaxWaitMs: 30 });
  send(log('stat up=1'));
  await until(() => posts.length === 1);
  await wait(150);
  assert.equal(posts.length, 1, 'the line is not posted again');
  await bridge.close();
});

test('after close(), nothing is sent and no timer is left', async (t) => {
  const { send, posts, bridge } = await ready(t, { logMaxWaitMs: 50 });
  send(log('stat up=1'));
  await wait(10);
  await bridge.close();
  await wait(150);
  await bridge.flush();
  await bridge.flush({ alone: true });
  assert.equal(posts.length, 0);
});

test('a logs-only post that hangs does not hold up the chain of decoder events', async (t) => {
  let release;
  const gate = new Promise((done) => { release = done; });
  const { posts, post } = posting();
  let hanging = 0;
  const { send, outbox, bridge } = await ready(t, { logMaxWaitMs: 30, post: async (decoder, batch) => {
    if (batch.passings.length === 0) {
      hanging += 1;
      await gate;
    }
    return post(decoder, batch);
  } });
  const seen = [];
  bridge.addEventListener('passing', (event) => seen.push(event.detail.t));
  send(log('stat up=1'));
  await until(() => hanging === 1);
  send(commands.lap('0A', 1000));
  await until(() => seen.length === 1);
  assert.equal(await outbox.count(), 1, 'stamped while the logs-only post hangs');
  release();
  await until(() => posts.some((x) => x.passings.length === 1));
  await bridge.close();
});

test('after a 403 the timer re-posts nothing', async (t) => {
  const posts = [];
  const { send, bridge } = await ready(t, { logMaxWaitMs: 50, post: async (decoder, batch) => { posts.push(batch); throw failing(403, 'no access'); } });
  send(log('stat up=1'));
  send(commands.lap('0A', 1000));
  await until(() => posts.length === 1);
  await wait(200);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].logs, ['stat up=1']);
  assert.equal(bridge.blocked, 1);
  await bridge.close();
});

test('a logs-only 401 stops and drops the remaining lines', async () => {
  const lines = Array.from({ length: 70 }, (_, i) => ({ decoder: 'd1', boot: 'b1', line: `stat n=${i}` }));
  let posted = 0;
  const result = await sendOutbox(memoryOutbox(), async () => { posted += 1; throw failing(401); }, () => {}, { lines, alone: true });
  assert.equal(posted, 1);
  assert.equal(result.sentLines.length, 70);
  assert.equal(result.refusal, null);
});

test('after a 403 the timer does not re-post the refused passings for lines under another boot', async (t) => {
  const posts = [];
  const { send, bridge } = await ready(t, { logMaxWaitMs: 50, post: async (decoder, batch) => { posts.push(batch); throw failing(403, 'no access'); } });
  send(log('stat a=1'));
  send('%TLID dec_1 b00tb00t&');
  send(log('stat b=1'));
  send(commands.lap('0A', 1000));
  await until(() => posts.length === 1);
  await wait(200);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].logs, ['stat b=1']);
  await bridge.close();
});

test('a logs-only flush leaves a pending retry of another decoder\'s passings in place', async (t) => {
  const outbox = memoryOutbox();
  await outbox.add({ decoder: 'dec_a', boot: 'b00tb00t', transponder: '0A', t: 1000 });
  let down = true;
  const { posts, post } = posting();
  const { send, bridge } = await ready(t, { outbox, retryMs: 150, logMaxWaitMs: 30, post: async (decoder, batch) => {
    if (decoder === 'dec_a' && down) throw failing(503);
    return post(decoder, batch);
  } });
  await until(() => bridge.online === false);
  send(log('stat up=1'));
  await until(() => posts.some((x) => x.logs));
  down = false;
  await until(() => posts.some((x) => x.decoder === 'dec_a'));
  assert.equal(await outbox.count(), 0);
  await bridge.close();
});

test('stamped lines go out after the port is lost, with the next flush of passings', async (t) => {
  let down = true;
  const { posts, post } = posting();
  const { sim, send, end, bridge } = await ready(t, { post: async (decoder, batch) => {
    if (down) throw failing(503);
    return post(decoder, batch);
  } });
  send(log('stat up=1'));
  send(commands.lap('0A', 1000));
  await until(() => bridge.online === false);
  end();
  await until(() => bridge.state === 'disconnected');
  down = false;
  await bridge.flush();
  assert.deepEqual(posts, [{ decoder: 'dec_1', boot: sim.boot, passings: [{ transponder: '0A', t: 1000 }], logs: ['stat up=1'] }]);
  await bridge.close();
});

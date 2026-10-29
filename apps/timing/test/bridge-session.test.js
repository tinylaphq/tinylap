// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge's session (decoders spec §2.4, §6.1): the handshake, the kinds,
// the boots, held passings, the race start and a late %TLID. Times are
// scaled down; the defaults test pins the real ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOT_ID, commands, frames } from '@tinylap/timing';
import { Bridge } from '../public/bridge.js';
import { hidTransport } from '../public/link/hid.js';
import { robitronicProtocol } from '../public/link/robitronic.js';
import { serialTransport } from '../public/link/serial.js';
import { zroundProtocol } from '../public/link/zround.js';
import { memoryOutbox } from '../public/outbox.js';
import { fakeSerialPort } from '../public/sim/serial-port.js';
import { fakeHidDevice } from '../public/sim/hid-device.js';
import { easylapModel } from '../public/sim/models/easylap.js';
import { tinylapModel } from '../public/sim/models/tinylap.js';
import { zroundModel } from '../public/sim/models/zround.js';

const FAST = { synMs: 20, handshakeMs: 300, spacingMs: 20, helloMs: 120, helloEveryMs: 40, startMs: 150, listenSynMs: 40, listenMs: 2000 };
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (fn, ms = 4000) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await fn()) return;
    await wait(5);
  }
  throw new Error('timed out');
};

/**
 * A serial port whose other end is `model` (m25). `writes` records each host write as
 * { text, at, boot } (the session's boot at that moment); `drop(text)` swallows a write.
 */
function modelPort(model, { drop = () => false } = {}) {
  const writes = [];
  let bridge = null;
  const spy = { ...model, write(bytes, now) {
    const text = new TextDecoder().decode(bytes);
    writes.push({ text, at: performance.now(), boot: bridge?.boot ?? null });
    return drop(text) ? [] : model.write(bytes, now);
  } };
  const port = fakeSerialPort(spy, { tickMs: 10 });
  return { port, writes, say: (line) => port.send(new TextEncoder().encode(line)), watch: (b) => { bridge = b; return b; } };
}
const silent = () => ({ transport: 'serial', info: {}, start: () => [], tick: () => [], write: () => [] });
const plain = (options = {}) => zroundModel({ cars: 0, bootMs: 0, ackMs: 5, acks: 3, ...options });
const count = (writes, text) => writes.filter((w) => w.text === text).length;
function posting() {
  const posts = [];
  return { posts, post: async (decoder, batch) => { posts.push({ decoder, ...batch }); return { through: batch.passings.length ? Math.max(...batch.passings.map((p) => p.t)) : null }; } };
}
function bridgeOn(rig, options = {}) {
  const { posts, post } = posting();
  const bridge = rig.watch(new Bridge({ port: rig.port, outbox: options.outbox ?? memoryOutbox(), post: options.post ?? post, ...FAST, ...options }));
  const states = [];
  bridge.addEventListener('state', () => states.push(bridge.state));
  return { bridge, posts, states };
}
const sent = (posts) => posts.flatMap((p) => p.passings.map((x) => ({ decoder: p.decoder, boot: p.boot, ...x })));

test('the defaults are the spec\'s', () => {
  const b = new Bridge({ port: fakeSerialPort(silent()), outbox: memoryOutbox(), post: async () => ({ through: null }) });
  assert.deepEqual(
    [b.openDelayMs, b.synMs, b.handshakeMs, b.spacingMs, b.helloMs, b.helloEveryMs, b.startMs, b.listenSynMs, b.listenMs, b.flushWaitMs, b.retryMs, b.replyMs, b.logMaxWaitMs],
    [0, 500, 6000, 300, 2500, 700, 6000, 2000, 60_000, 10_000, 5000, 3000, 10_000],
  );
});

test('the TinyLap handshake: %C& first, %TLHELLO& once, spaced after the answer, and never choose, listening or %I&', async () => {
  // No reset at open: a %TLID before the first write would skip %C&.
  const rig = modelPort(tinylapModel({ cars: 0, resetOnOpen: false }));
  const { bridge, states } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'unpaired');
  await wait(200);
  assert.equal(rig.writes[0].text, commands.startup);
  const hello = rig.writes.findIndex((w) => w.text === commands.hello);
  const lastSyn = rig.writes.slice(0, hello).filter((w) => w.text === commands.startup).at(-1);
  assert.ok(rig.writes[hello].at - lastSyn.at >= FAST.spacingMs - 2, 'spaced from the last %C&');
  assert.equal(count(rig.writes, commands.hello), 1, 'the hello repeats stop at the first %TLID');
  assert.equal(count(rig.writes, commands.reset), 0);
  assert.equal(bridge.kind, 'tinylap');
  assert.ok(!states.includes('choose') && !states.includes('listening'));
  await bridge.close();
});

test('a %TLID before %C&: the bridge never sends %C&, ends unpaired, then pairs', async (t) => {
  // The board resets on open and says who it is during the open delay, as with the real 1.5 s.
  const model = tinylapModel({ cars: 0 });
  const rig = modelPort(model);
  const { bridge, states } = bridgeOn(rig, { openDelayMs: 50 });
  t.after(() => bridge.close());
  await bridge.start();
  await until(() => bridge.state === 'unpaired');
  await wait(200);
  assert.equal(count(rig.writes, commands.startup), 0, 'no %C&');
  assert.equal(bridge.kind, 'tinylap');
  assert.ok(!states.includes('choose') && !states.includes('listening'));
  await bridge.pair('dec_1', 't'.repeat(43));
  await until(() => bridge.state === 'ready');
  assert.equal(model.sim.decoder, 'dec_1');
  assert.equal(bridge.boot, model.sim.boot);
  await bridge.close();
});

/**
 * A paired TinyLap decoder with one fast car, ready and forwarding; `reboot(lines)` resets it at the port's
 * current time and says those of its reset lines that `lines` keeps.
 */
async function rebooting(t) {
  const model = tinylapModel({ cars: 1, lapMs: 400, random: () => 0, decoder: 'dec_1' });
  let now = 0;
  const rig = modelPort({ ...model, tick: (n) => { now = n; return model.tick(n); } });
  const { bridge, posts, states } = bridgeOn(rig);
  t.after(() => bridge.close());
  await bridge.start();
  await until(() => bridge.state === 'ready' && sent(posts).length >= 2);
  const old = model.sim.boot;
  const reboot = (keep) => {
    const at = now;
    for (const line of model.sim.reply({ type: 'reset' }, at).filter(keep)) rig.say(line);
    return { at, wall: performance.now() };
  };
  return { model, rig, bridge, posts, states, old, reboot };
}

/** The passings after a reboot at `at` on the old boot's clock (`wall` on this one) carry the new boot, and none the old. */
async function forwardsTheNewBoot({ model, posts, old }, { at, wall }) {
  await until(() => sent(posts).filter((p) => p.boot === model.sim.boot).length >= 2, 6000);
  const all = sent(posts);
  const since = performance.now() - wall;
  assert.notEqual(model.sim.boot, old);
  assert.ok(all.every((p) => p.boot === old || p.boot === model.sim.boot));
  assert.ok(all.filter((p) => p.boot === old).every((p) => p.t <= at), 'nothing after the reboot carries the old boot');
  assert.ok(all.filter((p) => p.boot === model.sim.boot).every((p) => p.t <= since + 50), 'stamped on the new boot\'s clock, from zero');
}

test('a reboot with the port open: the passings after it carry the new boot, none the old, and no hello() loop starts', async (t) => {
  const rig = await rebooting(t);
  const hellos = count(rig.rig.writes, commands.hello);
  const before = rig.states.length;
  const at = rig.reboot(() => true);
  await forwardsTheNewBoot(rig, at);
  assert.equal(count(rig.rig.writes, commands.hello), hellos, 'the %TLID said it all: no hello, and the clock from zero is no clock back');
  assert.ok(!rig.states.slice(before).includes('connecting'));
  await rig.bridge.close();
});

test('the same reboot with its %TLID dropped: the boot line asks again', async (t) => {
  const rig = await rebooting(t);
  const hellos = count(rig.rig.writes, commands.hello);
  const at = rig.reboot((line) => !line.startsWith('%TLID'));
  // Well before the new boot's first %T (1 s), so the boot line asked, not a clock back.
  await until(() => count(rig.rig.writes, commands.hello) > hellos, 500);
  await until(() => rig.bridge.state === 'ready' && rig.bridge.boot === rig.model.sim.boot);
  await forwardsTheNewBoot(rig, at);
  await rig.bridge.close();
});

test('open delay and retry: a decoder that boots for 50 ms gets its %C& after the delay, or on a retry', async () => {
  const delayed = modelPort(plain({ bootMs: 50 }));
  const one = bridgeOn(delayed, { openDelayMs: 60 });
  await one.bridge.start();
  await until(() => one.bridge.state === 'choose');
  assert.equal(count(delayed.writes, commands.startup), 1);
  await one.bridge.close();
  const eager = modelPort(plain({ bootMs: 50 }));
  const two = bridgeOn(eager, { openDelayMs: 0 });
  await two.bridge.start();
  await until(() => two.bridge.state === 'choose');
  assert.ok(count(eager.writes, commands.startup) >= 2, 'the first was lost, a retry was answered');
  await two.bridge.close();
});

test('a plain ZRound decoder that waits for race start: choose, one %I& after the boot, then it forwards as the chosen decoder', async () => {
  const model = plain({ clockEveryMs: 50 });
  const rig = modelPort(model);
  const { bridge, posts } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'choose');
  assert.equal(bridge.kind, 'zround');
  await until(() => model.running);
  const start = rig.writes.find((w) => w.text === commands.reset);
  const lastHello = rig.writes.filter((w) => w.text === commands.hello).at(-1);
  assert.ok(start.at - lastHello.at >= FAST.spacingMs - 2, '%I& is spaced from the last hello');
  assert.match(start.boot, BOOT_ID, 'the boot was made before the write');
  await wait(400);
  assert.equal(count(rig.writes, commands.reset), 1);
  const writesAfterStart = rig.writes.length;
  await bridge.assign('dec_9');
  assert.equal(bridge.state, 'ready');
  rig.say(commands.lap('0A', 1000));
  rig.say(commands.lap('0A', 9000));
  await until(() => sent(posts).length === 2);
  assert.ok(sent(posts).every((p) => p.decoder === 'dec_9' && p.boot === bridge.boot && BOOT_ID.test(p.boot)));
  assert.equal(sent(posts)[0].boot, start.boot, 'the boot made right before %I& is the one the passings carry');
  await wait(200);
  assert.equal(rig.writes.length, writesAfterStart, 'nothing more is written to a running plain decoder');
  assert.ok(!rig.writes.some((w) => /^%TLPAIR|^%TLWIFI|^%F&/.test(w.text)));
  await assert.rejects(bridge.pair('dec_1', 't'.repeat(43)), /can't be paired over the cable/);
  await bridge.close();
});

test('%I& is retried with a new boot each time; after the last one the state stays choose, and its boot stays', async () => {
  const twice = modelPort(plain({ ignoresStarts: 1, clockEveryMs: 50 }));
  const a = bridgeOn(twice);
  await a.bridge.start();
  await until(() => count(twice.writes, commands.reset) === 2);
  const [first, second] = twice.writes.filter((w) => w.text === commands.reset);
  assert.notEqual(first.boot, second.boot);
  assert.ok(second.at - first.at >= FAST.startMs - 5);
  await a.bridge.close();

  const deaf = modelPort(plain({ ignoresStarts: 3 }));
  const b = bridgeOn(deaf);
  await b.bridge.start();
  await until(() => count(deaf.writes, commands.reset) === 3);
  await wait(FAST.startMs * 3);
  assert.equal(count(deaf.writes, commands.reset), 3);
  assert.ok(!b.states.includes('listening'));
  assert.equal(b.bridge.state, 'choose');
  const lastBoot = deaf.writes.filter((w) => w.text === commands.reset).at(-1).boot;
  const writes = deaf.writes.length;
  await b.bridge.assign('dec_9');
  deaf.say(commands.lap('0A', 1000));
  await until(() => sent(b.posts).length === 1);
  assert.equal(sent(b.posts)[0].boot, lastBoot);
  assert.equal(deaf.writes.length, writes, 'nothing after the last %I&');
  await b.bridge.close();
});

test('a %TLID after the first %I& makes the decoder TinyLap: no further %I&', async () => {
  const rig = modelPort(plain({ ignoresStarts: 3 }));
  const { bridge } = bridgeOn(rig);
  await bridge.start();
  await until(() => count(rig.writes, commands.reset) === 1);
  rig.say('%TLID dec_1 b00tb00t&');
  await until(() => bridge.kind === 'tinylap');
  await wait(FAST.startMs * 3);
  assert.equal(count(rig.writes, commands.reset), 1);
  await bridge.close();
});

test('a quiet running decoder, whose first clock comes after a while but before startMs, gets one %I&', async () => {
  // Scaled: RiCino's first clock at 5 s against startMs 6 s (spec §2.4, R1).
  // A clock every 100 ms against startMs 400 ms: wide margins on both sides of the first clock.
  const rig = modelPort(plain({ clockEveryMs: 100 }));
  const { bridge } = bridgeOn(rig, { startMs: 400 });
  await bridge.start();
  await until(() => bridge.state === 'choose');
  await wait(400 * 3);
  assert.equal(count(rig.writes, commands.reset), 1);
  await bridge.close();
});

test('the listening retry stops after listenMs, with one hello per %C& while listening', async () => {
  const rig = modelPort(silent());
  const { bridge } = bridgeOn(rig, { synMs: 10, handshakeMs: 40, listenSynMs: 20, listenMs: 200 });
  let listeningAt = Infinity;
  bridge.addEventListener('state', () => { if (bridge.state === 'listening') listeningAt = performance.now(); });
  await bridge.start();
  await until(() => bridge.state === 'listening');
  // Writes come every 20 ms while the retry runs; a quiet 100 ms means it stopped.
  await until(() => rig.writes.length > 0 && performance.now() - rig.writes.at(-1).at > 100);
  const n = count(rig.writes, commands.startup);
  const h = count(rig.writes, commands.hello);
  await wait(200);
  assert.equal(count(rig.writes, commands.startup), n);
  assert.equal(count(rig.writes, commands.hello), h, 'the listening hellos stop too');
  assert.ok(n > 3 && h >= 1);
  // One hello on entering listening, then one after each %C& (the last may fall past listenMs).
  const later = rig.writes.filter((w) => w.text === commands.startup && w.at >= listeningAt).length;
  assert.ok(h === later + 1 || h === later, `${h} hellos for ${later} %C& while listening`);
  await bridge.close();
});

test('a TinyLap firmware that ignores %C& is asked %TLHELLO& once listening, and ends unpaired', async () => {
  const hellosOnly = { transport: 'serial', info: {}, start: () => [], tick: () => [],
    write: (bytes) => (new TextDecoder().decode(bytes) === commands.hello ? [new TextEncoder().encode(commands.id(null, 'b00tb00t'))] : []) };
  const rig = modelPort(hellosOnly);
  const { bridge, states } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'unpaired');
  assert.equal(bridge.kind, 'tinylap');
  assert.ok(states.includes('listening'));
  assert.ok(rig.writes.findIndex((w) => w.text === commands.hello) > rig.writes.findIndex((w) => w.text === commands.startup));
  await bridge.close();
});

test('a free-running plain decoder gets no %I&', async () => {
  const rig = modelPort(plain({ waitsForStart: false, clockEveryMs: 30 }));
  const { bridge } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'choose');
  await wait(400);
  assert.equal(count(rig.writes, commands.reset), 0);
  await bridge.close();
});

test('held passings: before the kind and in choose they wait, each with its boot, and go in order after assign', async () => {
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge, posts } = bridgeOn(rig);
  await bridge.start();
  await wait(5);
  rig.say(commands.lap('0A', 1000)); // before any boot: it takes the first one (F1)
  await until(() => bridge.state === 'choose');
  rig.say(commands.lap('0A', 9000));
  rig.say(commands.clock(5000));
  rig.say(commands.clock(100)); // a clock back during choose: a new boot
  rig.say(commands.lap('0A', 300));
  await wait(50);
  assert.equal(sent(posts).length, 0, 'nothing before assign');
  await bridge.assign('dec_9');
  await until(() => sent(posts).length === 3);
  const byT = Object.fromEntries(sent(posts).map((p) => [p.t, p.boot]));
  assert.equal(byT[1000], byT[9000]);
  assert.notEqual(byT[9000], byT[300]);
  assert.equal(byT[300], bridge.boot);
  await bridge.close();
});

test('held passings: close before assign posts nothing', async () => {
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge, posts } = bridgeOn(rig);
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  await bridge.close();
  await wait(100);
  assert.equal(posts.length, 0);
});

test('one chain: a live passing during assign lands after the held ones', async () => {
  const inner = memoryOutbox();
  const order = [];
  const outbox = { ...inner, add: async (p) => { await wait(2); order.push(p.t); return inner.add(p); } };
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge } = bridgeOn(rig, { outbox });
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  for (let t = 2000; t <= 20_000; t += 1000) rig.say(commands.lap('0A', t));
  await wait(50);
  const assigning = bridge.assign('dec_9');
  rig.say(commands.lap('0A', 99_000));
  await assigning;
  await until(() => order.length === 21);
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
  assert.equal(order.at(-1), 99_000);
  await bridge.close();
});

test('once TinyLap, always TinyLap: a lost re-hello repeats until answered, and its passings wait for the new boot', async () => {
  const model = { ...tinylapModel({ cars: 0, decoder: 'dec_1', resetOnOpen: false }), tick: () => [] };
  let swallow = 0;
  const rig = modelPort(model, { drop: (text) => text === commands.hello && swallow-- > 0 });
  const { bridge, posts, states } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'ready');
  swallow = 2;
  rig.say(commands.clock(5000));
  rig.say(commands.clock(9000));
  model.sim.reply({ type: 'reset' }, 9000); // the reset's own %TLID got lost
  rig.say(commands.clock(100));
  await until(() => bridge.state === 'connecting');
  rig.say(commands.lap('0A', 500));
  await until(() => bridge.state === 'ready' && bridge.boot === model.sim.boot);
  await until(() => sent(posts).length === 1);
  assert.deepEqual(sent(posts)[0], { decoder: 'dec_1', boot: model.sim.boot, transponder: '0A', t: 500 });
  assert.equal(bridge.kind, 'tinylap');
  assert.ok(!states.includes('choose'));
  assert.ok(count(rig.writes, commands.hello) >= 4);
  await bridge.close();
});

test('a late %TLID: after the flush in flight, the browser-stamped passings leave the outbox, and none is re-stamped', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const posts = [];
  const post = async (decoder, batch) => { posts.push({ decoder, ...batch }); await gate; return { through: null }; };
  const outbox = memoryOutbox();
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge } = bridgeOn(rig, { outbox, post });
  const changed = [];
  bridge.addEventListener('identity-changed', () => changed.push(true));
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  await bridge.assign('dec_9');
  rig.say(commands.lap('0A', 9000));
  await until(async () => (await outbox.count()) === 2 && posts.length === 1);
  rig.say('%TLID dec_1 b00tb00t&');
  await wait(50);
  assert.equal(await outbox.count(), 2, 'nothing leaves while the flush is in flight');
  release();
  await until(() => bridge.kind === 'tinylap' && bridge.state === 'ready');
  assert.equal(posts.length, 2);
  assert.ok(posts[1].passings.some((p) => p.t === 9000), 'the flush in flight finished first, 9000 included');
  assert.equal(await outbox.count(), 0);
  assert.ok(!(await outbox.list()).some((p) => p.decoder === 'dec_1'));
  assert.deepEqual(changed, [true]);
  await bridge.close();
});

test('a late %TLID gives up on a flush that hangs, after flushWaitMs', async () => {
  const outbox = memoryOutbox();
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge } = bridgeOn(rig, { outbox, post: () => new Promise(() => {}), flushWaitMs: 50 });
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  await bridge.assign('dec_9');
  await wait(20);
  rig.say('%TLID dec_1 b00tb00t&');
  await until(() => bridge.kind === 'tinylap' && bridge.state === 'ready', 1000);
  assert.equal(await outbox.count(), 0);
  await bridge.close();
});

test('boots for a plain decoder: a new one on %I& from it, on a clock back, and on a passing more than 1.5 s back', async () => {
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge } = bridgeOn(rig);
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  await bridge.assign('dec_9');
  const boots = [bridge.boot];
  const seen = [];
  bridge.addEventListener('passing', (event) => seen.push(event.detail));
  const step = async (done, ...lines) => { for (const l of lines) rig.say(l); await until(done); boots.push(bridge.boot); };
  const newBoot = () => bridge.boot !== boots.at(-1);
  await step(newBoot, '%I&');
  assert.equal(bridge.references.size, 0);
  await step(newBoot, commands.clock(5000), commands.clock(100));
  await step(() => seen.length === 2, commands.lap('0A', 10_000), commands.lap('0B', 8000));
  await step(() => seen.length === 4, commands.lap('0A', 20_000), commands.lap('0B', 19_000));
  assert.equal(new Set(boots.slice(0, 4)).size, 4, 'a new boot each time');
  assert.equal(boots[4], boots[3], 'not for 1 s back');
  await bridge.close();
});

test('a reconnect is a new boot', async () => {
  const boots = [];
  for (let i = 0; i < 2; i += 1) {
    const rig = modelPort(plain({ clockEveryMs: 50 }));
    const { bridge } = bridgeOn(rig);
    await bridge.start();
    await until(() => bridge.state === 'choose');
    boots.push(bridge.boot);
    await bridge.close();
  }
  assert.notEqual(boots[0], boots[1]);
});

test('no write after close', async () => {
  const rig = modelPort(silent());
  // Count calls to the transport's write itself: after close() the serial writer is released, so a write that got
  // through would be rejected before it reached the model, and rig.writes alone couldn't tell.
  const transport = serialTransport(rig.port);
  let calls = 0;
  const counted = { ...transport, write: (bytes) => { calls += 1; return transport.write(bytes); } };
  const bridge = new Bridge({ link: { transport: counted, protocol: zroundProtocol() }, outbox: memoryOutbox(), post: async () => ({ through: null }), ...FAST, synMs: 10, replyMs: 20 });
  await bridge.start();
  await until(() => calls >= 1);
  await bridge.close();
  const n = calls;
  await wait(100);
  // pair() is the one path that writes without a timer.
  await bridge.pair('dec_1', 't'.repeat(43)).catch(() => {});
  assert.equal(calls, n);
});

test('a choice made after the device was unplugged is refused', async () => {
  const rig = modelPort(plain({ clockEveryMs: 50 }));
  const { bridge } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'choose');
  rig.port.unplug();
  await until(() => bridge.state === 'disconnected');
  await assert.rejects(bridge.assign('dec_9'), /disconnected/);
  assert.equal(bridge.state, 'disconnected');
});

test('a protocol reader that throws ends the session: disconnected, no unhandled rejection, nothing written after', async () => {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  const rig = modelPort(silent());
  const broken = { ...zroundProtocol(), push: () => { throw new Error('bad bytes'); } };
  const bridge = rig.watch(new Bridge({ link: { transport: serialTransport(rig.port), protocol: broken }, outbox: memoryOutbox(), post: async () => ({ through: null }), ...FAST }));
  await bridge.start();
  rig.say('%A&');
  await until(() => bridge.state === 'disconnected');
  assert.equal(bridge.lastError?.message, 'bad bytes');
  const n = rig.writes.length;
  await wait(FAST.handshakeMs + 100);
  assert.equal(rig.writes.length, n);
  process.off('unhandledRejection', onRejection);
  assert.deepEqual(rejections, []);
  await bridge.close();
});

test('a non-fatal error mid-line in a TinyLap session leaves it ready, and the next passing is forwarded', async (t) => {
  const rig = modelPort(tinylapModel({ cars: 0, decoder: 'dec_1' }));
  const { bridge, posts } = bridgeOn(rig);
  t.after(() => bridge.close());
  await bridge.start();
  await until(() => bridge.state === 'ready');
  rig.say('%L2A,1F');
  await wait(20);
  rig.port.glitch('FramingError');
  rig.say('00&%T2000&');
  rig.say(commands.lap('0B', 0x2100));
  await until(() => sent(posts).length >= 1);
  await wait(50);
  assert.deepEqual(sent(posts).map((p) => [p.transponder, p.t]), [['0B', 0x2100]], 'no 2A spliced across the gap');
  assert.equal(bridge.state, 'ready');
  await bridge.close();
});

/** A transport that counts the writes that reach it, and the session over it. */
function counting(rig, options = {}) {
  const transport = serialTransport(rig.port);
  const counter = { calls: 0 };
  const counted = { ...transport, write: (bytes) => { counter.calls += 1; return transport.write(bytes); } };
  const bridge = new Bridge({ link: { transport: counted, protocol: zroundProtocol() }, outbox: memoryOutbox(), post: async () => ({ through: null }), ...FAST, ...options });
  const states = [];
  bridge.addEventListener('state', () => states.push(bridge.state));
  return { bridge, counter, states };
}
const timeouts = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

test('an unplug during the open delay ends disconnected: no write after it, no timer left', async () => {
  const rig = modelPort(silent());
  const before = timeouts();
  const { bridge, counter, states } = counting(rig, { openDelayMs: 50 });
  const starting = bridge.start();
  await wait(10);
  rig.port.unplug();
  await until(() => bridge.state === 'disconnected');
  await starting;
  await wait(FAST.handshakeMs + 50);
  assert.deepEqual(states, ['connecting', 'disconnected']);
  assert.equal(counter.calls, 0);
  assert.ok(timeouts() <= before, 'no timer left behind');
  await bridge.close();
});

test('an unplug during the handshake ends disconnected: no write after it, no timer left', async () => {
  const rig = modelPort(silent());
  const before = timeouts();
  const { bridge, counter, states } = counting(rig);
  await bridge.start();
  await until(() => counter.calls >= 2);
  rig.port.unplug();
  await until(() => bridge.state === 'disconnected');
  const n = counter.calls;
  await wait(FAST.handshakeMs + 50);
  assert.equal(counter.calls, n);
  assert.deepEqual(states, ['connecting', 'disconnected']);
  assert.ok(timeouts() <= before, 'no timer left behind');
  await bridge.close();
});

test('hello() keeps one retry: repeated clock-backs and pairings do not stack helloMs loops', async () => {
  const model = { ...tinylapModel({ cars: 0, decoder: 'dec_1', resetOnOpen: false }), tick: () => [] };
  let swallow = false;
  const rig = modelPort(model, { drop: (text) => swallow && text === commands.hello });
  const { bridge } = bridgeOn(rig);
  await bridge.start();
  await until(() => bridge.state === 'ready');
  swallow = true;
  for (let i = 0; i < 3; i += 1) {
    rig.say(commands.clock(5000));
    rig.say(commands.clock(100));
  }
  await until(() => bridge.state === 'connecting');
  await bridge.pair('dec_1', 't'.repeat(43));
  await bridge.pair('dec_1', 't'.repeat(43));
  const from = rig.writes.length;
  await wait(FAST.helloMs * 4 + 20);
  const hellos = count(rig.writes.slice(from), commands.hello);
  assert.ok(hellos >= 3 && hellos <= 5, `one hello per helloMs, not stacked: ${hellos} in 4 helloMs`);
  await bridge.close();
});

test('hello(): a retry timer that fired behind a newer hello() does nothing, so no second loop starts', async () => {
  const rig = modelPort({ ...tinylapModel({ cars: 0, decoder: 'dec_1', resetOnOpen: false }), tick: () => [] }, { drop: (text) => text === commands.hello });
  const { bridge } = bridgeOn(rig);
  rig.say('%TLID dec_1 b00tb00t&');
  await bridge.start();
  await until(() => bridge.state === 'ready');
  // Hold the write of the first hello, so its retry timer fires and queues behind it, and a second hello() (as pair() makes) comes before that callback runs.
  const write = bridge.transport.write.bind(bridge.transport);
  let release;
  const gate = new Promise((done) => { release = done; });
  let held = false;
  bridge.transport.write = async (bytes) => {
    if (!held && new TextDecoder().decode(bytes) === commands.hello) {
      held = true;
      await gate;
    }
    return write(bytes);
  };
  rig.say(commands.clock(5000));
  rig.say(commands.clock(100));
  await until(() => held);
  await wait(FAST.helloMs + 40);
  await bridge.hello();
  release();
  const from = rig.writes.length;
  await wait(FAST.helloMs * 5);
  const hellos = count(rig.writes.slice(from), commands.hello);
  assert.ok(hellos >= 4 && hellos <= 7, `one retry loop: ${hellos} hellos in 5 helloMs`);
  await bridge.close();
});

test('close drops the queue: what was waiting on the chain stamps nothing and posts nothing', async () => {
  const inner = memoryOutbox();
  const added = [];
  const outbox = { ...inner, add: async (p) => { await wait(10); added.push(p.t); return inner.add(p); } };
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge, posts } = bridgeOn(rig, { outbox });
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  for (let t = 2000; t <= 6000; t += 1000) rig.say(commands.lap('0A', t));
  await wait(30);
  const assigning = bridge.assign('dec_9').catch(() => {});
  rig.say(commands.lap('0A', 99_000));
  await until(() => added.length >= 1);
  await bridge.close();
  await assigning;
  await wait(100);
  assert.ok(added.length <= 2, `at most the add in flight finishes: ${added}`);
  assert.ok(!added.includes(99_000), 'the queued live passing is not stamped');
  const postedBefore = posts.length;
  await wait(50);
  assert.equal(posts.length, postedBefore);
  assert.ok(sent(posts).length <= 1);
});

test('a late %TLID in choose drops the held passings (F2), and a passing after it carries the TinyLap identity', async () => {
  const outbox = memoryOutbox();
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge, posts } = bridgeOn(rig, { outbox });
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  rig.say(commands.lap('0A', 9000));
  rig.say('%TLID dec_1 b00tb00t&');
  await until(() => bridge.kind === 'tinylap' && bridge.state === 'ready');
  await wait(50);
  assert.equal(posts.length, 0, 'the held passings are dropped, not stamped');
  assert.equal(await outbox.count(), 0);
  rig.say(commands.lap('0A', 20_000));
  await until(() => sent(posts).length === 1);
  assert.deepEqual(sent(posts), [{ decoder: 'dec_1', boot: 'b00tb00t', transponder: '0A', t: 20_000 }]);
  await bridge.close();
});

test('the plain path sends exactly three hellos, helloEveryMs apart', async (t) => {
  // The third hello is due about 200 ms after the first, well inside the 600 ms window.
  const timing = { helloMs: 600, helloEveryMs: 100 };
  const rig = modelPort(plain({ waitsForStart: false, clockEveryMs: 30 }));
  const { bridge } = bridgeOn(rig, timing);
  // Closed even when an assertion fails, so its timers can't keep the test process alive.
  t.after(() => bridge.close());
  await bridge.start();
  await until(() => bridge.state === 'choose');
  // Shows that no fourth hello comes.
  await wait(300);
  const hellos = rig.writes.filter((w) => w.text === commands.hello);
  assert.equal(hellos.length, 3);
  for (let i = 1; i < 3; i += 1) assert.ok(hellos[i].at - hellos[i - 1].at >= timing.helloEveryMs - 2, 'helloEveryMs apart');
});

test('at most 500 passings are held: the oldest go first', async () => {
  const rig = modelPort(plain({ clockEveryMs: 1e9 }));
  const { bridge, posts } = bridgeOn(rig);
  await bridge.start();
  rig.say(commands.lap('0A', 1000));
  await until(() => bridge.state === 'choose');
  for (let i = 1; i <= 505; i += 1) rig.say(commands.lap('0A', 1000 + i * 2000));
  await until(() => bridge.heldCount === 500 && bridge.mismatches === 0 && sent(posts).length === 0);
  await bridge.assign('dec_9');
  await until(() => sent(posts).length === 500);
  const ts = sent(posts).map((p) => p.t).sort((a, b) => a - b);
  assert.equal(ts[0], 1000 + 6 * 2000, 'the first six are dropped');
  assert.equal(ts.at(-1), 1000 + 505 * 2000);
  await bridge.close();
});

// %TLLOG lines: holding, dropping, and the boot rule (spec §2.2).

const log = (line) => `%TLLOG ${line}&`;
const logged = (posts) => posts.filter((p) => p.logs).map((p) => ({ decoder: p.decoder, boot: p.boot, logs: p.logs }));

test('lines are held in connecting and stamped by the next %TLID', async (t) => {
  const rig = modelPort(silent());
  const { bridge, posts } = bridgeOn(rig, { logMaxWaitMs: 50, helloMs: 2000 });
  t.after(() => bridge.close());
  await bridge.start();
  assert.equal(bridge.state, 'connecting');
  rig.say(log('stat up=1'));
  await wait(30);
  assert.deepEqual(posts, []);
  rig.say('%TLID dec_1 b00tb00t&');
  await until(() => posts.length === 1);
  assert.deepEqual(posts, [{ decoder: 'dec_1', boot: 'b00tb00t', passings: [], logs: ['stat up=1'] }]);
  await bridge.close();
});

test('lines are dropped while unpaired, for a plain ZRound decoder, on #decide and on a late %TLID', async (t) => {
  const options = { logMaxWaitMs: 30 };
  // Unpaired, then paired.
  const unpaired = modelPort(tinylapModel({ cars: 0 }));
  const a = bridgeOn(unpaired, options);
  t.after(() => a.bridge.close());
  await a.bridge.start();
  await until(() => a.bridge.state === 'unpaired');
  unpaired.say(log('stat up=1'));
  await wait(20);
  await a.bridge.pair('dec_1', 't'.repeat(43));
  await until(() => a.bridge.state === 'ready');
  await wait(100);
  assert.deepEqual(logged(a.posts), [], 'unpaired');
  await a.bridge.close();
  // Held before the kind is known, then the kind is decided as plain ZRound; then a line in ready.
  const decided = modelPort(plain({ clockEveryMs: 1e9 }));
  const b = bridgeOn(decided, options);
  t.after(() => b.bridge.close());
  await b.bridge.start();
  decided.say(log('stat up=1'));
  await until(() => b.bridge.state === 'choose');
  await b.bridge.assign('dec_9');
  decided.say(log('stat up=2'));
  decided.say(commands.lap('0A', 1000));
  await until(() => sent(b.posts).length === 1);
  await wait(100);
  assert.deepEqual(logged(b.posts), [], 'on #decide and for a plain decoder');
  await b.bridge.close();
  // A line in choose, then a late %TLID.
  const late = modelPort(plain({ clockEveryMs: 1e9 }));
  const c = bridgeOn(late, options);
  t.after(() => c.bridge.close());
  await c.bridge.start();
  await until(() => c.bridge.state === 'choose');
  late.say(log('stat up=1'));
  late.say('%TLID dec_1 b00tb00t&');
  await until(() => c.bridge.kind === 'tinylap' && c.bridge.state === 'ready');
  await wait(100);
  assert.deepEqual(logged(c.posts), [], 'on a late %TLID');
  await c.bridge.close();
});

test('at most 256 lines are held, the oldest dropped first', async (t) => {
  const rig = modelPort(silent());
  const { bridge, posts } = bridgeOn(rig, { logMaxWaitMs: 50, helloMs: 2000 });
  t.after(() => bridge.close());
  await bridge.start();
  const lines = Array.from({ length: 300 }, (_, i) => `stat n=${i}`);
  for (const line of lines) rig.say(log(line));
  rig.say('%TLID dec_1 b00tb00t&');
  await until(() => posts.flatMap((p) => p.logs).length >= 256);
  await wait(100);
  assert.deepEqual(posts.flatMap((p) => p.logs), lines.slice(44));
  assert.ok(posts.every((p) => p.logs.length <= 64));
  await bridge.close();
});

test('a boot line straight after its boot-changing %TLID starts no hello()', async (t) => {
  // No power-up lines at open: the test builds its own line sequence.
  const rig = modelPort(tinylapModel({ cars: 0, decoder: 'dec_1', resetOnOpen: false }));
  const { bridge, posts, states } = bridgeOn(rig, { logMaxWaitMs: 30 });
  t.after(() => bridge.close());
  await bridge.start();
  await until(() => bridge.state === 'ready');
  rig.say(commands.clock(5000));
  const hellos = count(rig.writes, commands.hello);
  const before = states.length;
  rig.say('%TLID dec_1 b00tb00t&');
  rig.say(log('boot reason=x'));
  await until(() => posts.length === 1);
  assert.equal(count(rig.writes, commands.hello), hellos);
  assert.ok(!states.slice(before).includes('connecting'));
  assert.deepEqual(logged(posts), [{ decoder: 'dec_1', boot: 'b00tb00t', logs: ['boot reason=x'] }]);
  await bridge.close();
});

test('a boot line after anything else calls hello(), and the passings after it wait for the new boot', async (t) => {
  for (const line of ['boot reason=x', 'boot reason=x fw=a"b']) {
    const model = tinylapModel({ cars: 0, decoder: 'dec_1' });
    const rig = modelPort(model);
    const { bridge, posts } = bridgeOn(rig, { logMaxWaitMs: 30 });
    t.after(() => bridge.close());
    await bridge.start();
    await until(() => bridge.state === 'ready');
    const old = bridge.boot;
    rig.say(commands.clock(5000));
    const hellos = count(rig.writes, commands.hello);
    model.sim.reply({ type: 'reset' }, 9000); // the reset's own %TLID got lost
    rig.say(log(line));
    rig.say(commands.lap('0A', 500));
    await until(() => sent(posts).length === 1);
    assert.equal(count(rig.writes, commands.hello), hellos + 1, line);
    assert.notEqual(model.sim.boot, old);
    assert.deepEqual(sent(posts), [{ decoder: 'dec_1', boot: model.sim.boot, transponder: '0A', t: 500 }], line);
    if (line === 'boot reason=x') {
      await until(() => logged(posts).length > 0);
      assert.deepEqual(logged(posts).flatMap((p) => p.logs), [line]);
      assert.ok(logged(posts).every((p) => p.boot === model.sim.boot), 'the line itself waits for the new boot');
    }
    await bridge.close();
  }
});

test('a boot line parseLog rejects still triggers the rule', async (t) => {
  // No power-up lines at open: the test builds its own line sequence.
  const model = tinylapModel({ cars: 0, decoder: 'dec_1', resetOnOpen: false });
  const rig = modelPort(model);
  const { bridge, posts } = bridgeOn(rig, { logMaxWaitMs: 30 });
  t.after(() => bridge.close());
  await bridge.start();
  await until(() => bridge.state === 'ready');
  rig.say(commands.clock(5000));
  const hellos = count(rig.writes, commands.hello);
  rig.say(log('boot reason=x fw=a"b'));
  await until(() => count(rig.writes, commands.hello) === hellos + 1);
  await until(() => bridge.state === 'ready');
  await wait(100);
  assert.deepEqual(logged(posts), [], 'a line parseLog rejects is not sent');
  await bridge.close();
});

function hidRig(model, options = {}) {
  const hid = new EventTarget();
  const device = fakeHidDevice(model, { hid, tickMs: 10 });
  const { posts, post } = posting();
  const bridge = new Bridge({ link: { transport: hidTransport(device, { hid }), protocol: robitronicProtocol() }, outbox: memoryOutbox(), post, ...FAST, ...options });
  return { device, bridge, posts };
}

test('an EasyLap: easylap on the first good heartbeat, then it forwards as the chosen decoder, and a heartbeat back is a new boot', async () => {
  const { device, bridge, posts } = hidRig(easylapModel({ cars: 0, heartbeatMs: 20 }));
  await bridge.start();
  await until(() => bridge.state === 'choose');
  assert.equal(bridge.kind, 'easylap');
  await bridge.assign('dec_9');
  device.send(frames.passing(0x123456, 12345, 12, 200));
  await until(() => sent(posts).length === 1);
  assert.deepEqual(sent(posts)[0], { decoder: 'dec_9', boot: bridge.boot, transponder: '123456', t: 12345 });
  const before = bridge.boot;
  // Each try is a clock far behind the device's own beats; the first one that follows a beat is a clock back.
  await until(() => {
    device.send(frames.heartbeat(1));
    return bridge.boot !== before;
  });
  assert.deepEqual(device.writes, [], 'nothing is written while frames come');
  await bridge.close();
});

test('an EasyLap frame that fails its checksum never makes a boot and never posts', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { device, bridge, posts } = hidRig(easylapModel({ cars: 0, heartbeatMs: 20 }));
    const noise = [];
    bridge.addEventListener('noise', () => noise.push(true));
    await bridge.start();
    await until(() => bridge.state === 'choose');
    await bridge.assign('dec_9');
    const before = bridge.boot;
    const back = frames.heartbeat(1);
    back[1] ^= 0xff;
    const passing = frames.passing(0x123456, 99_999, 1, 1);
    passing[1] ^= 0xff;
    device.send(back);
    device.send(passing);
    await until(() => bridge.mismatches >= 2 && noise.length >= 2);
    assert.equal(bridge.boot, before);
    assert.equal(posts.length, 0);
    await bridge.close();
  } finally {
    console.warn = warn;
  }
});

test('an EasyLap that waits for a start gets 03 B9 01 after handshakeMs, then forwards; a silent one gets three, then listening', async () => {
  const waiting = hidRig(easylapModel({ cars: 0, waitsForStart: true, heartbeatMs: 20 }), { handshakeMs: 50 });
  await waiting.bridge.start();
  await until(() => waiting.bridge.state === 'choose');
  assert.deepEqual(waiting.device.writes, [[0x03, 0xb9, 0x01]]);
  await waiting.bridge.close();
  const quiet = { transport: 'hid', info: { vendorId: 0x10c4, productId: 0x86b9 }, start: () => [], tick: () => [], write: () => [] };
  const silentLap = hidRig(quiet, { handshakeMs: 50 });
  await silentLap.bridge.start();
  await until(() => silentLap.bridge.state === 'listening', 4000);
  await wait(600);
  assert.equal(silentLap.device.writes.length, 3);
  await silentLap.bridge.close();
});

test('heartbeats are never held: 600 of them during choose drop no passing', async () => {
  const { device, bridge, posts } = hidRig(easylapModel({ cars: 0, heartbeatMs: 1 }));
  await bridge.start();
  await until(() => bridge.state === 'choose');
  device.send(frames.passing(0x0a1b2c, 50_000, 9, 180));
  await until(() => bridge.heldCount === 1);
  await wait(800);
  await bridge.assign('dec_9');
  await until(() => sent(posts).length === 1);
  assert.equal(sent(posts)[0].transponder, 'A1B2C');
  await bridge.close();
});

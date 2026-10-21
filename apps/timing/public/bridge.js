// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge (spec §5; decoders spec §2.4): a decoder on USB, read through a
// transport (Web Serial, or WebHID for an EasyLap) and a protocol reader
// (ZRound with TinyLap's %TL… commands, or Robitronic), forwarded to the
// server with the member's session.
// - The handshake: %C& until the decoder answers, then %TLHELLO&, spaced so
//   RiCino-style firmware reads both, and retried.
// - A TinyLap decoder says who it is (%TLID): its id and its boot.
// - A plain ZRound decoder (or an EasyLap, Task 8) can't: the member chooses
//   which decoder it is (assign), and the bridge makes its boots. A plain
//   decoder that doesn't stream gets %I&, its race start.
// - Passings wait in memory until the identity is known, then in an outbox
//   until the server holds them. Laps are computed locally for the preview.
// - Decoder events, timers and assign() run on one chain, in order.
import { MAX_BATCH, MIN_LAP_MS, commands, nextLap, passingKey, randomBoot } from '@tinylap/timing';
import { serialTransport } from './link/serial.js';
import { zroundProtocol } from './link/zround.js';

const encode = (line) => new TextEncoder().encode(line);
/** At most this many passings wait for the decoder's identity, oldest dropped first (spec §2.4). */
const HELD_MAX = 500;
/** %TLHELLO& at most this often in the handshake, and %I& at most this often (spec §2.4). */
const HELLOS = 3;
const STARTS = 3;
const BROWSER_ASSIGNED = new Set(['zround', 'easylap']);

/** @typedef {{ boot: string | null, transponder: string, t: number, hits?: number, strength?: number }} Held */

export class Bridge extends EventTarget {
  #replies = [];
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  #timers = new Set();
  #retryTimer = null;
  #flushing = null;
  #again = false;
  #closed = false;
  /** The one chain every decoder event, timer and assign() runs on (spec §2.4, R3). @type {Promise<unknown>} */
  #serial = Promise.resolve();
  #openedAt = 0;
  #lastWrite = -Infinity;
  /** The device answered something in its protocol. */
  #heard = false;
  /** The decoder sent a clock or a passing. */
  #streaming = false;
  #hellos = 0;
  #starts = 0;
  /** The last clock the decoder sent. @type {number | null} */
  #clock = null;
  /** The latest passing time of this boot, for a browser-assigned decoder (rule 4). @type {number | null} */
  #latest = null;
  /** Passings waiting for the decoder's identity. @type {Held[]} */
  #held = [];
  /** Keys of the passings this connection stamped with a browser-assigned id. */
  #stamped = new Set();
  /** @type {any} */ transport;
  /** @type {any} */ protocol;
  /** @type {any} */ device;
  /** @type {any} */ port;
  /** @type {ReturnType<typeof import('./outbox.js').memoryOutbox>} */ outbox;
  /** @type {(decoderId: string, batch: any) => Promise<{ through: number | null }>} */ post;
  /** @type {number} */ openDelayMs;
  /** @type {number} */ synMs;
  /** @type {number} */ handshakeMs;
  /** @type {number} */ spacingMs;
  /** @type {number} */ helloMs;
  /** @type {number} */ helloEveryMs;
  /** @type {number} */ startMs;
  /** @type {number} */ listenSynMs;
  /** @type {number} */ listenMs;
  /** @type {number} */ flushWaitMs;
  /** @type {number} */ retryMs;
  /** @type {number} */ replyMs;

  /**
   * @param {{ link?: { transport: any, protocol: any } | null, port?: any, outbox: ReturnType<typeof import('./outbox.js').memoryOutbox>,
   *   post: (decoderId: string, batch: { boot: string, passings: { transponder: string, t: number }[] }) => Promise<{ through: number | null }>,
   *   openDelayMs?: number, synMs?: number, handshakeMs?: number, spacingMs?: number, helloMs?: number, helloEveryMs?: number,
   *   startMs?: number, listenSynMs?: number, listenMs?: number, flushWaitMs?: number, retryMs?: number, replyMs?: number }} options
   */
  constructor({ link = null, port = null, outbox, post, openDelayMs = 0, synMs = 500, handshakeMs = 6000, spacingMs = 300, helloMs = 2500,
    helloEveryMs = 700, startMs = 6000, listenSynMs = 2000, listenMs = 60_000, flushWaitMs = 10_000, retryMs = 5000, replyMs = 3000 }) {
    super();
    const { transport, protocol } = link ?? { transport: serialTransport(port), protocol: zroundProtocol() };
    Object.assign(this, { transport, protocol, port, outbox, post, openDelayMs, synMs, handshakeMs, spacingMs, helloMs, helloEveryMs, startMs, listenSynMs, listenMs, flushWaitMs, retryMs, replyMs });
    this.device = transport.device;
    this.state = 'idle';
    /** @type {'tinylap' | 'zround' | 'easylap' | null} */
    this.kind = null;
    this.decoder = null;
    this.boot = null;
    this.online = true;
    this.lastError = null;
    /** How many passings the last refusal (lastError) dropped from the outbox. */
    this.dropped = 0;
    /** How many passings the last flush held back: for a club this sign-in has no access to (a 403). */
    this.blocked = 0;
    /** Transponder → the mark its laps are measured from, for the preview. */
    this.references = new Map();
  }

  #set(state) {
    this.state = state;
    this.dispatchEvent(new Event('state'));
  }

  #setOnline(online, error = null) {
    this.lastError = error;
    if (this.online === online) return;
    this.online = online;
    this.dispatchEvent(new Event('online'));
  }

  /** Runs fn after everything before it on the one chain; the result is fn's. @template T @param {() => T | Promise<T>} fn @returns {Promise<T>} */
  #chain(fn) {
    const run = this.#serial.then(fn);
    this.#serial = run.catch(() => {});
    return run;
  }

  /** @param {number} ms @param {() => unknown} fn */
  #later(ms, fn) {
    const id = setTimeout(() => {
      this.#timers.delete(id);
      if (!this.#closed) this.#chain(fn).catch((error) => this.#setOnline(false, error));
    }, ms);
    this.#timers.add(id);
  }

  #stopTimers() {
    for (const id of this.#timers) clearTimeout(id);
    this.#timers.clear();
  }

  /** Nothing is written after close (I13), nor once the port is gone: a queued item would only throw. @param {Uint8Array} bytes */
  async #write(bytes) {
    if (this.#closed || this.state === 'disconnected') return;
    this.#lastWrite = performance.now();
    await this.transport.write(bytes);
  }

  /** How long until spacingMs has passed since the last write. */
  #spaced() {
    return Math.max(0, this.#lastWrite + this.spacingMs - performance.now());
  }

  async start() {
    await this.transport.open({ baudRate: this.protocol.baudRate });
    if (this.#closed) {
      await this.transport.close();
      return;
    }
    this.#openedAt = performance.now();
    void this.#read();
    this.#set('connecting');
    if (this.openDelayMs) await new Promise((done) => setTimeout(done, this.openDelayMs));
    if (this.#closed) return;
    this.#later(this.handshakeMs, () => this.#enterListening());
    await this.#chain(() => this.#syn());
    void this.flush();
  }

  /** %C& until the decoder answers; while listening, every listenSynMs with a %TLHELLO& after it, until listenMs after open (spec §2.4, R1, R7). */
  async #syn() {
    if (this.#heard || this.kind) return;
    if (performance.now() - this.#openedAt >= this.listenMs) return;
    await this.#write(encode(commands.startup));
    if (this.state === 'listening') this.#later(this.spacingMs, () => this.#listenHello());
    this.#later(this.state === 'listening' ? this.listenSynMs : this.synMs, () => this.#syn());
  }

  /** No answer within handshakeMs: listening, with a %TLHELLO& for TinyLap firmware that ignores %C&, as today's bridge asked at once. */
  #enterListening() {
    if (this.#heard || this.kind) return;
    this.#set('listening');
    this.#later(this.#spaced(), () => this.#listenHello());
  }

  /** One %TLHELLO& while listening, until listenMs after open. A %TLID makes the decoder TinyLap; RiCino ignores it. */
  async #listenHello() {
    if (this.#heard || this.kind || performance.now() - this.#openedAt >= this.listenMs) return;
    await this.#write(encode(commands.hello));
  }

  /** Asks a TinyLap decoder who it is, again every helloMs until it answers (I5). Also after pairing. */
  async hello() {
    this.#set('connecting');
    this.#later(this.helloMs, () => {
      if (this.state === 'connecting' && this.kind === 'tinylap') return this.hello();
    });
    await this.#write(encode(commands.hello));
  }

  async #read() {
    let broken = false;
    try {
      for await (const bytes of this.transport.bytes()) {
        let events;
        try {
          events = this.protocol.push(bytes);
        } catch (error) {
          // A reader that can't read the bytes leaves nothing to go on: the session ends, as for a lost port.
          this.lastError = error;
          broken = true;
          break;
        }
        for (const event of events) {
          try {
            await this.#chain(() => this.#handle(event));
          } catch (error) {
            // A handler failure (say the outbox can't store) is not a lost port: say so and keep reading.
            this.#setOnline(false, error);
          }
        }
      }
    } finally {
      this.#stopTimers();
      if (!this.#closed) this.#set('disconnected');
    }
    if (broken) await this.transport.close().catch(() => {});
  }

  /** @param {import('@tinylap/timing/types').DecoderEvent} event */
  async #handle(event) {
    switch (event.type) {
      case 'alive': return this.#alive();
      case 'identity': return this.#identity(event);
      case 'clock': return this.#onClock(event.t);
      case 'reset':
        if (this.kind !== 'tinylap' && this.boot) this.#newBoot();
        return undefined;
      case 'passing': return this.#onPassing(event);
      case 'ok':
      case 'error':
        this.#replies.shift()?.(event);
        return undefined;
      default: return undefined;
    }
  }

  #alive() {
    if (this.#heard) return;
    this.#heard = true;
    if (this.kind) return;
    if (this.state === 'listening') this.#set('connecting');
    this.#later(this.#spaced(), () => this.#sendHello());
  }

  /** Up to HELLOS hellos, helloEveryMs apart, stopping at the first %TLID (R7). The first opens the window. */
  async #sendHello() {
    if (this.kind || this.#hellos >= HELLOS) return;
    this.#hellos += 1;
    if (this.#hellos === 1) this.#later(this.helloMs, () => this.#windowOver());
    if (this.#hellos < HELLOS) this.#later(this.helloEveryMs, () => this.#sendHello());
    await this.#write(encode(commands.hello));
  }

  #windowOver() {
    if (this.kind) return;
    this.#decide('zround');
    if (!this.#streaming) this.#later(this.#spaced(), () => this.#raceStart());
  }

  /** @param {'zround' | 'easylap'} kind */
  #decide(kind) {
    this.kind = kind;
    this.#newBoot();
    this.#set('choose');
  }

  /** %I& to a plain decoder that doesn't stream, up to STARTS times, startMs apart, each after a new boot (C1, R1). */
  async #raceStart() {
    if (this.#streaming || this.#starts >= STARTS || this.kind !== 'zround') return;
    this.#starts += 1;
    this.#newBoot();
    await this.#write(encode(commands.reset));
    if (this.#starts < STARTS) this.#later(this.startMs, () => this.#later(this.#spaced(), () => this.#raceStart()));
  }

  /** @param {{ decoder: string | null, boot: string }} identity */
  async #identity({ decoder, boot }) {
    if (this.kind === 'zround') await this.#dropBrowserStamped();
    this.kind = 'tinylap';
    if (boot !== this.boot) {
      this.references.clear();
      this.#clock = null;
    }
    this.decoder = decoder;
    this.boot = boot;
    for (const p of this.#held) p.boot ??= boot;
    this.#set(decoder ? 'ready' : 'unpaired');
    if (!decoder) {
      this.#held = [];
      return;
    }
    await this.#stampHeld();
    void this.flush();
  }

  /**
   * A late %TLID (I6, R4, F2): once the flush in flight is done, the passings this connection stamped with the browser's id
   * leave the outbox, unsent, and the held ones go too. Nothing is re-stamped. The wait is bounded by flushWaitMs: a post
   * that hangs must not stall every decoder event behind it on the chain.
   */
  async #dropBrowserStamped() {
    let timer;
    await Promise.race([this.#flushing, new Promise((done) => { timer = setTimeout(done, this.flushWaitMs); })]);
    clearTimeout(timer);
    const mine = (await this.outbox.list()).filter((p) => this.#stamped.has(passingKey(p)));
    await this.outbox.remove(mine);
    this.#stamped.clear();
    this.#held = [];
    this.dispatchEvent(new Event('identity-changed'));
  }

  /** @param {number} t */
  async #onClock(t) {
    this.#streaming = true;
    const back = this.#clock !== null && t < this.#clock;
    this.#clock = t;
    if (!back) return;
    // A clock that went back means the decoder rebooted (power, %I&) with the port open.
    if (this.kind === 'tinylap') {
      await this.hello();
    } else if (this.boot) {
      this.#newBoot();
      this.#clock = t;
    }
  }

  /** @param {{ transponder: string, t: number, hits?: number, strength?: number }} passing */
  async #onPassing({ transponder, t, hits, strength }) {
    this.#streaming = true;
    if (this.kind !== 'tinylap' && this.boot) {
      if (this.#latest !== null && t < this.#latest - MIN_LAP_MS) this.#newBoot();
      this.#latest = Math.max(this.#latest ?? t, t);
    }
    /** @type {Held} */
    const held = { boot: this.kind === 'tinylap' && this.state !== 'ready' ? null : this.boot, transponder, t, hits, strength };
    if (this.state === 'ready') return this.#stamp(held);
    if (this.kind === 'tinylap' && this.state === 'unpaired') return undefined;
    this.#held.push(held);
    if (this.#held.length > HELD_MAX) this.#held.shift();
    return undefined;
  }

  /** A browser-made boot (spec §2.4, rules 1–4). A passing held before any boot takes the first one (F1). */
  #newBoot() {
    this.boot = randomBoot();
    this.references.clear();
    this.#clock = null;
    this.#latest = null;
    for (const p of this.#held) p.boot ??= this.boot;
  }

  /** @param {Held} held */
  async #stamp({ boot, transponder, t, hits, strength }) {
    const passing = { decoder: this.decoder, boot, transponder, t };
    const step = nextLap(this.references.get(transponder) ?? null, { boot, t });
    this.references.set(transponder, step.reference);
    await this.outbox.add(passing);
    if (BROWSER_ASSIGNED.has(this.kind)) this.#stamped.add(passingKey(passing));
    this.dispatchEvent(new CustomEvent('passing', { detail: { ...passing, lapMs: step.kind === 'lap' ? step.ms : null, hits, strength } }));
    void this.flush();
  }

  async #stampHeld() {
    const held = this.#held;
    this.#held = [];
    for (const p of held) await this.#stamp(p);
  }

  /** The browser's choice of decoder for a plain ZRound decoder or an EasyLap (spec §3.2). Writes nothing to the device. @param {string} decoderId */
  assign(decoderId) {
    return this.#chain(async () => {
      if (this.#closed || this.state === 'disconnected') throw new Error('The decoder is disconnected. Connect it again.');
      if (!BROWSER_ASSIGNED.has(this.kind)) throw new Error('This decoder says who it is; it is paired, not chosen.');
      this.decoder = decoderId;
      this.#set('ready');
      await this.#stampHeld();
      void this.flush();
    });
  }

  /** The decoder's next %TLOK& or %TLERR&, or a timeout. */
  #reply() {
    return new Promise((resolve, reject) => {
      const answer = (message) => {
        clearTimeout(timer);
        if (message.type === 'ok') resolve(message);
        else reject(new Error(`The decoder said: ${message.text}`));
      };
      // A request that timed out leaves the queue, so later replies match later requests.
      const timer = setTimeout(() => {
        const i = this.#replies.indexOf(answer);
        if (i !== -1) this.#replies.splice(i, 1);
        reject(new Error("The decoder didn't answer."));
      }, this.replyMs);
      this.#replies.push(answer);
    });
  }

  /** Stores the decoder's id and token on the board (and Wi-Fi, if given), then asks again who it is. */
  async pair(decoderId, token, wifi = null) {
    if (BROWSER_ASSIGNED.has(this.kind)) throw new Error("This decoder can't be paired over the cable.");
    let reply = this.#reply();
    await this.#write(encode(commands.pair(decoderId, token)));
    await reply;
    if (wifi) {
      reply = this.#reply();
      await this.#write(encode(commands.wifi(wifi.ssid, wifi.password)));
      await reply;
    }
    await this.hello();
  }

  /** Sends the outbox; retries later when the server can't be reached. */
  flush() {
    if (this.#closed) return Promise.resolve();
    if (this.#flushing) {
      this.#again = true;
      return this.#flushing;
    }
    clearTimeout(this.#retryTimer);
    this.#flushing = (async () => {
      try {
        // A batch taken or refused for good: either way the server answered, and the outbox changed.
        const { refusal, dropped, blocked } = await sendOutbox(this.outbox, this.post, () => {
          this.#setOnline(true);
          this.dispatchEvent(new Event('outbox'));
        });
        this.blocked = blocked;
        if (refusal) Object.assign(this, { lastError: refusal, dropped });
      } catch (error) {
        this.#setOnline(false, error);
        if (!this.#closed) this.#retryTimer = setTimeout(() => void this.flush(), this.retryMs);
      } finally {
        this.#flushing = null;
        this.dispatchEvent(new Event('outbox'));
      }
      if (this.#again) {
        this.#again = false;
        await this.flush();
      }
    })();
    return this.#flushing;
  }

  async close() {
    this.#closed = true;
    clearTimeout(this.#retryTimer);
    this.#stopTimers();
    this.#held = [];
    await this.transport.close();
  }
}

/** The answers that mean these passings will never be taken: no such decoder (it was removed,
 * or never paired), or a batch the server can't read. */
const FINAL = new Set([404, 422]);

/**
 * Sends an outbox one decoder and boot at a time (spec §5), and drops the passings it sent, up to
 * the server's `through`. What the other answers do, so each flush sends what can be sent:
 * - a 404 or 422 (FINAL): the batch is dropped, and the others go on;
 * - a 403, no access to that decoder's club: its passings wait, and the other decoders go on;
 * - a 401, signed out: every batch would fail the same way, so it throws and keeps everything;
 * - a 413, 429, 5xx or network error throws too, keeping the rest for a retry.
 * It returns the last refusal and how many passings were dropped, and the last 403 and how many
 * passings it holds back. A thrown error carries `dropped`, `refusal` and `blocked` from before it.
 * @param {ReturnType<typeof import('./outbox.js').memoryOutbox>} outbox
 * @param {(decoderId: string, batch: { boot: string, passings: { transponder: string, t: number }[] }) => Promise<{ through: number | null }>} post
 * @param {() => void} [onSent] called after each batch the server answered with a 2xx, 403, 404 or 422
 * @returns {Promise<{ refusal: any, dropped: number, forbidden: any, blocked: number }>}
 */
export async function sendOutbox(outbox, post, onSent = () => {}) {
  let refusal = null;
  let dropped = 0;
  let forbidden = null;
  let blocked = 0;
  const skipped = new Set();
  for (;;) {
    const items = (await outbox.list()).filter((p) => !skipped.has(p.decoder));
    if (items.length === 0) break;
    const [first] = items;
    const group = items.filter((p) => p.decoder === first.decoder && p.boot === first.boot).sort((a, b) => a.t - b.t).slice(0, MAX_BATCH);
    let through;
    try {
      ({ through } = await post(first.decoder, { boot: first.boot, passings: group.map(({ transponder, t }) => ({ transponder, t })) }));
    } catch (error) {
      const status = /** @type {any} */ (error)?.status;
      if (status === 403) {
        skipped.add(first.decoder);
        blocked += items.filter((p) => p.decoder === first.decoder).length;
        forbidden = error;
        onSent();
        continue;
      }
      if (!FINAL.has(status)) {
        if (error && typeof error === 'object') Object.assign(error, { dropped, refusal, blocked });
        throw error;
      }
      await outbox.remove(group);
      dropped += group.length;
      refusal = error;
      onSent();
      continue;
    }
    // Only what this batch carried: a passing of the same boot that wasn't sent stays, whatever `through` says.
    await outbox.remove(group.filter((p) => through !== null && p.t <= through));
    onSent();
    // The server stores what it is sent, so `through` covers the group; if not, stop rather than loop.
    if (through === null || through < group.at(-1).t) break;
  }
  return { refusal, dropped, forbidden, blocked };
}

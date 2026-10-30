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
// - A plain ZRound decoder (or an EasyLap, which streams once its UART is on and
//   gets a start only as a fallback) can't: the member chooses
//   which decoder it is (assign), and the bridge makes its boots. A plain
//   decoder that doesn't stream gets %I&, its race start.
// - Passings wait in memory until the identity is known, then in an outbox
//   until the server holds them. Laps are computed locally for the preview.
// - A TinyLap decoder's %TLLOG lines are stamped as passings are, and kept in
//   memory: they go with the next batch of passings for their boot, or alone
//   after logMaxWaitMs (spec §2.2, §2.4, §2.6).
// - Decoder events, timers and assign() run on one chain, in order.
import { MAX_BATCH, MAX_LOG_BYTES, MAX_LOG_LINES, MIN_LAP_MS, commands, frames, nextLap, passingKey, randomBoot } from '@tinylap/timing';
import { serialTransport } from './link/serial.js';
import { zroundProtocol } from './link/zround.js';

const encode = (line) => new TextEncoder().encode(line);
/** At most this many passings wait for the decoder's identity, oldest dropped first (spec §2.4). */
const HELD_MAX = 500;
/** %TLHELLO& at most this often in the handshake, and %I& at most this often (spec §2.4). */
const HELLOS = 3;
const STARTS = 3;
/** The EasyLap start fallback, at most STARTS times, this far apart (spec §2.4). */
const ROBITRONIC_START_EVERY_MS = 500;
const BROWSER_ASSIGNED = new Set(['zround', 'easylap']);
/** At most this many %TLLOG lines are held and queued together, oldest dropped first (spec §2.4). */
const LOGS_MAX = 256;

/** @typedef {{ boot: string | null, transponder: string, t: number, hits?: number, strength?: number }} Held */
/** A %TLLOG line without "TLLOG " and "&"; decoder and boot are null while it is held. @typedef {{ decoder: string | null, boot: string | null, line: string }} LogEntry */
/** @typedef {{ boot: string, passings: { transponder: string, t: number }[], logs?: string[] }} Batch */

/** The decoder stored the pairing but refused the Wi-Fi settings; `reason` is its %TLERR text. */
export class WifiRefusedError extends Error {
  name = 'WifiRefusedError';
  /** @param {string} reason */
  constructor(reason) {
    super(`The decoder said: ${reason}`);
    this.reason = reason;
  }
}

/** The decoder stored the pairing but didn't answer the Wi-Fi settings. */
export class WifiUnconfirmedError extends Error {
  name = 'WifiUnconfirmedError';
  constructor() { super("The decoder didn't answer."); }
}

export class Bridge extends EventTarget {
  #replies = [];
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  #timers = new Set();
  #retryTimer = null;
  /** hello()'s one retry. @type {ReturnType<typeof setTimeout> | null} */
  #helloTimer = null;
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
  /** %TLLOG lines: held (no decoder yet) or stamped and queued to send (spec §2.2, §2.6). @type {LogEntry[]} */
  #logs = [];
  /** The last protocol message was a %TLID that changed the boot (spec §2.2). */
  #bootChanged = false;
  /** The logs-only flush, logMaxWaitMs after the first line queued (spec §2.4). @type {ReturnType<typeof setTimeout> | null} */
  #logTimer = null;
  /** A logs-only flush was asked for while one was in flight. */
  #againAlone = false;
  /** A normal flush was asked for while one was in flight: the rerun is a normal one, so no passing waits for the log timer. */
  #againFull = false;
  /** The decoder id the server answered 404 for: its %TLID means 'unknown' until the decoder is paired again. @type {string | null} */
  #unknown = null;
  /** @type {any} */ transport;
  /** @type {any} */ protocol;
  /** @type {any} */ device;
  /** @type {any} */ port;
  /** @type {ReturnType<typeof import('./outbox.js').memoryOutbox>} */ outbox;
  /** @type {(decoderId: string, batch: Batch) => Promise<{ through: number | null }>} */ post;
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
  /** @type {number} */ logMaxWaitMs;

  /**
   * @param {{ link?: { transport: any, protocol: any } | null, port?: any, outbox: ReturnType<typeof import('./outbox.js').memoryOutbox>,
   *   post: (decoderId: string, batch: Batch) => Promise<{ through: number | null }>,
   *   openDelayMs?: number, synMs?: number, handshakeMs?: number, spacingMs?: number, helloMs?: number, helloEveryMs?: number,
   *   startMs?: number, listenSynMs?: number, listenMs?: number, flushWaitMs?: number, retryMs?: number, replyMs?: number,
   *   logMaxWaitMs?: number }} options
   */
  constructor({ link = null, port = null, outbox, post, openDelayMs = 0, synMs = 500, handshakeMs = 6000, spacingMs = 300, helloMs = 2500,
    helloEveryMs = 700, startMs = 6000, listenSynMs = 2000, listenMs = 60_000, flushWaitMs = 10_000, retryMs = 5000, replyMs = 3000,
    logMaxWaitMs = 10_000 }) {
    super();
    const { transport, protocol } = link ?? { transport: serialTransport(port), protocol: zroundProtocol() };
    Object.assign(this, { transport, protocol, port, outbox, post, openDelayMs, synMs, handshakeMs, spacingMs, helloMs, helloEveryMs, startMs, listenSynMs, listenMs, flushWaitMs, retryMs, replyMs, logMaxWaitMs });
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
    // A lost port is the end of this session: nothing that was already queued brings it back.
    if (this.state === 'disconnected') return;
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

  /** Nothing is scheduled, and nothing runs, once the session is closed or its port is gone. @param {number} ms @param {() => unknown} fn */
  #later(ms, fn) {
    if (this.#ended()) return null;
    const id = setTimeout(() => {
      this.#timers.delete(id);
      if (!this.#ended()) this.#chain(fn).catch((error) => this.#setOnline(false, error));
    }, ms);
    this.#timers.add(id);
    return id;
  }

  #ended() {
    return this.#closed || this.state === 'disconnected';
  }

  #stopTimers() {
    for (const id of this.#timers) clearTimeout(id);
    this.#timers.clear();
  }

  /** Nothing is written after close (I13), nor once the port is gone: a queued item would only throw. @param {Uint8Array} bytes */
  async #write(bytes) {
    if (this.#ended()) return;
    this.#lastWrite = performance.now();
    await this.transport.write(bytes);
  }

  /** How long until spacingMs has passed since the last write. */
  #spaced() {
    return Math.max(0, this.#lastWrite + this.spacingMs - performance.now());
  }

  /** How many frames failed their checksum (only an EasyLap's reader counts them). */
  get mismatches() {
    return this.protocol.mismatches ?? 0;
  }

  /** How many passings wait for the decoder's identity. */
  get heldCount() {
    return this.#held.length;
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
    if (this.#ended()) return;
    if (this.protocol.kind === 'robitronic') {
      // The EasyLap streams once its UART is on; a start is only a fallback (spec §2.4).
      this.#later(this.handshakeMs, () => this.#robitronicStart(0));
    } else {
      this.#later(this.handshakeMs, () => this.#enterListening());
      await this.#chain(() => this.#syn());
    }
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
    // One retry at a time: a second clock back or pairing restarts it rather than adding a loop.
    if (this.#helloTimer) {
      clearTimeout(this.#helloTimer);
      this.#timers.delete(this.#helloTimer);
    }
    const mine = this.#later(this.helloMs, () => {
      // A hello() queued ahead of this callback made a newer timer: this one is stale and does nothing.
      if (this.#helloTimer !== mine) return undefined;
      this.#helloTimer = null;
      if (this.state === 'connecting' && this.kind === 'tinylap') return this.hello();
      return undefined;
    });
    this.#helloTimer = mine;
    await this.#write(encode(commands.hello));
  }

  async #read() {
    let broken = false;
    try {
      for await (const bytes of this.transport.bytes()) {
        // A non-fatal read error lost bytes here: the reader joins nothing across the gap (spec §3.3).
        if (bytes === null) {
          this.protocol.reset?.();
          continue;
        }
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
    // close() drops the queue: what was waiting on the chain does nothing (spec §2.4).
    if (this.#closed) return undefined;
    // Whether the message before this one was a boot-changing %TLID (spec §2.2). alive is an event, not a message.
    const afterBootChange = this.#bootChanged;
    if (event.type !== 'alive') this.#bootChanged = event.type === 'identity' && event.boot !== this.boot;
    switch (event.type) {
      case 'alive': return this.#alive();
      case 'identity': return this.#identity(event);
      case 'clock': return this.#onClock(event.t);
      case 'reset':
        if (this.kind !== 'tinylap' && this.boot) this.#newBoot();
        return undefined;
      case 'passing': return this.#onPassing(event);
      case 'log': return this.#onLog(event, afterBootChange);
      case 'noise':
        if (event.detail === 'checksum') this.dispatchEvent(new Event('noise'));
        // A boot line parseLog rejects still marks a boot, so a malformed fw= can't switch the rule off.
        if (event.detail.startsWith('TLLOG boot ')) return this.#bootLine(afterBootChange);
        return undefined;
      case 'ok':
      case 'error':
        this.#replies.shift()?.(event);
        return undefined;
      default: return undefined;
    }
  }

  #alive() {
    if (this.#heard) return undefined;
    this.#heard = true;
    if (this.protocol.kind === 'robitronic') return this.#decide('easylap');
    if (this.kind) return undefined;
    if (this.state === 'listening') this.#set('connecting');
    this.#later(this.#spaced(), () => this.#sendHello());
    return undefined;
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
    this.#dropHeldLines();
    this.#newBoot();
    this.#set('choose');
  }

  /**
   * The Robitronic start, only if no good frame came within handshakeMs: up to three, 500 ms apart, as
   * FlipSide sends it, then listening (spec §2.4). While the kind is undecided nothing is held, since
   * a passing needs a good frame, which decides the kind first; so no boot is made for this write.
   * @param {number} sentSoFar
   */
  async #robitronicStart(sentSoFar) {
    if (this.kind) return;
    if (sentSoFar === STARTS) {
      this.#set('listening');
      return;
    }
    await this.#write(frames.start);
    this.#later(ROBITRONIC_START_EVERY_MS, () => this.#robitronicStart(sentSoFar + 1));
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
    const known = decoder !== null && decoder !== this.#unknown;
    this.#set(known ? 'ready' : decoder ? 'unknown' : 'unpaired');
    if (!known) {
      this.#held = [];
      this.#dropHeldLines();
      return;
    }
    for (const entry of this.#logs) if (entry.decoder === null) Object.assign(entry, { decoder, boot });
    this.#armLogTimer();
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
    this.#dropHeldLines();
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
    if (this.kind === 'tinylap' && (this.state === 'unpaired' || this.state === 'unknown')) return undefined;
    this.#held.push(held);
    if (this.#held.length > HELD_MAX) this.#held.shift();
    return undefined;
  }

  /**
   * A %TLLOG line (spec §2.2): queued in ready, held until the next %TLID while the kind or the boot isn't known, and
   * dropped while unpaired or for a decoder whose boots are the browser's.
   * @param {{ line: string, boot: boolean }} log @param {boolean} afterBootChange
   */
  async #onLog({ line, boot }, afterBootChange) {
    if (boot) await this.#bootLine(afterBootChange);
    if (this.#closed || this.state === 'unpaired' || this.state === 'unknown' || BROWSER_ASSIGNED.has(this.kind)) return;
    const ready = this.state === 'ready';
    this.#logs.push({ decoder: ready ? this.decoder : null, boot: ready ? this.boot : null, line });
    if (this.#logs.length > LOGS_MAX) this.#logs.shift();
    this.#armLogTimer();
  }

  /**
   * The firmware writes a boot line straight after the %TLID that starts the boot. One after anything else means that
   * %TLID was lost: ask again, so what follows waits for the new boot (spec §2.2). @param {boolean} afterBootChange
   */
  async #bootLine(afterBootChange) {
    if (this.kind === 'tinylap' && this.state === 'ready' && !afterBootChange) await this.hello();
  }

  #dropHeldLines() {
    this.#logs = this.#logs.filter((entry) => entry.decoder !== null);
  }

  /** The first stamped line with no timer running starts one; lines after it don't restart it (spec §2.4). */
  #armLogTimer() {
    if (this.#logTimer !== null || !this.#logs.some((entry) => entry.decoder !== null)) return;
    const mine = this.#later(this.logMaxWaitMs, () => {
      // A timer cancelled after it fired, or replaced, does nothing.
      if (this.#logTimer !== mine) return;
      this.#logTimer = null;
      // Not awaited: this runs on the chain, and a POST there would stall every decoder event behind it.
      void this.flush({ alone: true });
    });
    this.#logTimer = mine;
  }

  #cancelLogTimer() {
    if (this.#logTimer === null) return;
    clearTimeout(this.#logTimer);
    this.#timers.delete(this.#logTimer);
    this.#logTimer = null;
  }

  /**
   * A 404 for this TinyLap decoder's own id: the server doesn't know its pairing (deleted, or paired elsewhere). Forwarding
   * stops, and what it sends is dropped as while unpaired, until it is paired again. @param {Set<string> | undefined} missing
   */
  #checkKnown(missing) {
    if (this.kind !== 'tinylap' || !this.decoder || !missing?.has(this.decoder)) return;
    this.#unknown = this.decoder;
    this.#held = [];
    this.#logs = this.#logs.filter((entry) => entry.decoder !== this.#unknown);
    this.#set('unknown');
  }

  /** @param {LogEntry[]} sent */
  #forgetLines(sent) {
    const done = new Set(sent);
    this.#logs = this.#logs.filter((entry) => !done.has(entry));
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
    if (this.#closed) return;
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
      if (this.#ended()) throw new Error('The decoder is disconnected. Connect it again.');
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
        else reject(Object.assign(new Error(`The decoder said: ${message.text}`), { reason: message.text }));
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

  /**
   * Stores the decoder's id and token on the board (and Wi-Fi, if given), then asks again who it is.
   * Once the pairing is stored, the bridge asks whatever the Wi-Fi answer, so a paired board ends ready;
   * then it rejects with WifiRefusedError or WifiUnconfirmedError if the Wi-Fi settings weren't taken (spec §5.2).
   */
  async pair(decoderId, token, wifi = null) {
    if (BROWSER_ASSIGNED.has(this.kind)) throw new Error("This decoder can't be paired over the cable.");
    let reply = this.#reply();
    await this.#write(encode(commands.pair(decoderId, token)));
    await reply;
    let failure = null;
    if (wifi) {
      reply = this.#reply();
      await this.#write(encode(commands.wifi(wifi.ssid, wifi.password)));
      failure = await reply.then(() => null, (caught) => (typeof caught.reason === 'string' ? new WifiRefusedError(caught.reason) : new WifiUnconfirmedError()));
    }
    await this.hello();
    if (failure) throw failure;
  }

  /**
   * Sends the outbox, with the stamped %TLLOG lines; retries later when the server can't be reached.
   * `alone` (the log timer's flush) also sends lines without passings (spec §2.4).
   */
  flush({ alone = false } = {}) {
    if (this.#closed) return Promise.resolve();
    if (this.#flushing) {
      this.#again = true;
      if (alone) this.#againAlone = true;
      else this.#againFull = true;
      return this.#flushing;
    }
    // A logs-only flush posts only the decoders with lines, so it leaves a pending retry of the others' passings alone.
    if (!alone) clearTimeout(this.#retryTimer);
    const lines = this.#logs.filter((entry) => entry.decoder !== null);
    this.#flushing = (async () => {
      // Whether lines left after a logs-only flush may go again on the timer: not after a 401 or a 413, say.
      let rearm = alone;
      try {
        // A batch taken or refused for good: either way the server answered, and the outbox changed.
        const { refusal, dropped, blocked, sentLines, missing } = await sendOutbox(this.outbox, this.post, () => {
          this.#setOnline(true);
          this.dispatchEvent(new Event('outbox'));
        }, { lines, alone });
        this.#forgetLines(sentLines);
        this.blocked = blocked;
        if (refusal) Object.assign(this, { lastError: refusal, dropped });
        this.#checkKnown(missing);
      } catch (error) {
        this.#forgetLines(/** @type {any} */ (error)?.sentLines ?? []);
        this.#checkKnown(/** @type {any} */ (error)?.missing);
        rearm &&= keepsLines(/** @type {any} */ (error)?.status);
        this.#setOnline(false, error);
        clearTimeout(this.#retryTimer);
        if (!this.#closed) this.#retryTimer = setTimeout(() => void this.flush(), this.retryMs);
      } finally {
        this.#flushing = null;
        this.dispatchEvent(new Event('outbox'));
      }
      if (!this.#logs.some((entry) => entry.decoder !== null)) this.#cancelLogTimer();
      else if (rearm) this.#armLogTimer();
      if (this.#again) {
        const full = this.#againFull;
        const alone = this.#againAlone;
        this.#again = false;
        this.#againAlone = false;
        this.#againFull = false;
        await this.flush({ alone: !full });
        // The log timer's flush was merged into a normal one: the lines it didn't carry go on the timer again.
        if (full && alone) this.#armLogTimer();
      }
    })();
    return this.#flushing;
  }

  async close() {
    this.#closed = true;
    clearTimeout(this.#retryTimer);
    this.#stopTimers();
    this.#logTimer = null;
    this.#held = [];
    this.#logs = [];
    await this.transport.close();
  }
}

/** The answers that mean these passings will never be taken: no such decoder (it was removed,
 * or never paired), or a batch the server can't read. */
const FINAL = new Set([404, 422]);
/** The answers that keep the %TLLOG lines a batch carried for the next flush: a 429, a 5xx or the network (spec §2.6). @param {number | undefined} status */
const keepsLines = (status) => status === undefined || status === 429 || status >= 500;
const utf8 = new TextEncoder();

/**
 * Sends an outbox one decoder and boot at a time (spec §5), and drops the passings it sent, up to
 * the server's `through`. What the other answers do, so each flush sends what can be sent:
 * - a 404 or 422 (FINAL): the batch is dropped, and the others go on; a 404's decoder is in `missing`;
 * - a 403, no access to that decoder's club: its passings wait, and the other decoders go on;
 * - a 401, signed out: every batch would fail the same way, so it throws and keeps everything;
 * - a 413, 429, 5xx or network error throws too, keeping the rest for a retry.
 * It returns the last refusal and how many passings were dropped, and the last 403 and how many
 * passings it holds back. A thrown error carries `dropped`, `refusal`, `blocked`, `sentLines` and `missing` from before it.
 *
 * %TLLOG lines (spec §2.6) ride along: each group carries up to MAX_LOG_LINES (MAX_LOG_BYTES) of its own
 * decoder and boot, in queue order. Only when no group is left, and `alone` is set, do the rest go in
 * logs-only batches; `alone` also limits the groups to the decoders that have lines. A logs-only answer is
 * never reported: no onSent, refusal, drop, block or throw. `sentLines` holds the lines this flush is done
 * with: sent, or dropped by their answer (only a 429, a 5xx or the network keeps them).
 * @param {ReturnType<typeof import('./outbox.js').memoryOutbox>} outbox
 * @param {(decoderId: string, batch: Batch) => Promise<{ through: number | null }>} post
 * @param {() => void} [onSent] called after each batch of passings the server answered with a 2xx, 403, 404 or 422
 * @param {{ lines?: LogEntry[], alone?: boolean }} [logs]
 * @returns {Promise<{ refusal: any, dropped: number, forbidden: any, blocked: number, sentLines: LogEntry[], missing: Set<string> }>}
 */
export async function sendOutbox(outbox, post, onSent = () => {}, { lines = [], alone = false } = {}) {
  let refusal = null;
  let dropped = 0;
  let forbidden = null;
  let blocked = 0;
  const skipped = new Set();
  /** The decoders a 404 answered: the server doesn't know them. @type {Set<string>} */
  const missing = new Set();
  /** @type {LogEntry[]} */
  const sentLines = [];
  const done = new Set();
  /** @param {LogEntry[]} entries */
  const finish = (entries) => {
    for (const entry of entries) done.add(entry);
    sentLines.push(...entries);
  };
  /** The next lines of one decoder and boot, in queue order. @param {string} decoder @param {string} boot */
  const take = (decoder, boot) => {
    const taken = [];
    let bytes = 0;
    for (const entry of lines) {
      if (taken.length === MAX_LOG_LINES) break;
      if (entry.decoder !== decoder || entry.boot !== boot || done.has(entry)) continue;
      bytes += utf8.encode(entry.line).length;
      if (bytes > MAX_LOG_BYTES) break;
      taken.push(entry);
    }
    return taken;
  };
  const withLines = new Set(lines.map((entry) => entry.decoder));
  let ranOut = false;
  for (;;) {
    const items = (await outbox.list()).filter((p) => !skipped.has(p.decoder) && (!alone || withLines.has(p.decoder)));
    if (items.length === 0) {
      ranOut = true;
      break;
    }
    const [first] = items;
    const group = items.filter((p) => p.decoder === first.decoder && p.boot === first.boot).sort((a, b) => a.t - b.t).slice(0, MAX_BATCH);
    const carried = take(first.decoder, first.boot);
    const passings = group.map(({ transponder, t }) => ({ transponder, t }));
    let through;
    try {
      ({ through } = await post(first.decoder, carried.length ? { boot: first.boot, passings, logs: carried.map((entry) => entry.line) } : { boot: first.boot, passings }));
    } catch (error) {
      const status = /** @type {any} */ (error)?.status;
      if (!keepsLines(status)) finish(carried);
      if (status === 403) {
        // A refused decoder's other lines go too, so no timer posts its passings again for them.
        finish(lines.filter((entry) => entry.decoder === first.decoder && !done.has(entry)));
        skipped.add(first.decoder);
        blocked += items.filter((p) => p.decoder === first.decoder).length;
        forbidden = error;
        onSent();
        continue;
      }
      if (!FINAL.has(status)) {
        if (error && typeof error === 'object') Object.assign(error, { dropped, refusal, blocked, sentLines, missing });
        throw error;
      }
      if (status === 404) missing.add(first.decoder);
      await outbox.remove(group);
      dropped += group.length;
      refusal = error;
      onSent();
      continue;
    }
    finish(carried);
    // Only what this batch carried: a passing of the same boot that wasn't sent stays, whatever `through` says.
    await outbox.remove(group.filter((p) => through !== null && p.t <= through));
    onSent();
    // The server stores what it is sent, so `through` covers the group; if not, stop rather than loop.
    if (through === null || through < group.at(-1).t) break;
  }
  // The lines no group carried, in logs-only batches per decoder and boot (spec §2.4). A decoder a 403 refused gets
  // none: its lines are dropped. A 429, a 5xx or the network stops, keeping the rest for the next flush; a 401
  // stops and drops the rest, as every batch would fail the same way.
  while (ranOut && alone) {
    const next = lines.find((entry) => !done.has(entry));
    if (!next) break;
    const decoder = /** @type {string} */ (next.decoder);
    if (skipped.has(decoder)) {
      finish(lines.filter((entry) => entry.decoder === decoder && !done.has(entry)));
      continue;
    }
    const boot = /** @type {string} */ (next.boot);
    const carried = take(decoder, boot);
    try {
      await post(decoder, { boot, passings: [], logs: carried.map((entry) => entry.line) });
    } catch (error) {
      const status = /** @type {any} */ (error)?.status;
      if (keepsLines(status)) break;
      if (status === 401) {
        finish(lines.filter((entry) => !done.has(entry)));
        break;
      }
      if (status === 403) skipped.add(decoder);
    }
    finish(carried);
  }
  return { refusal, dropped, forbidden, blocked, sentLines, missing };
}

// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge (spec §5): a decoder on USB, read through a transport and a protocol reader (decoders spec §2), forwarded
// to the server with the member's session. It asks the decoder who it is
// (%TLHELLO&) — again whenever its clock goes back, a reboot — so its passings carry the same key as the copies the decoder
// sends over Wi-Fi, pairs unpaired decoders, keeps an outbox while offline,
// and computes laps locally for an instant preview.
import { MAX_BATCH, commands, nextLap } from '@tinylap/timing';
import { serialTransport } from './link/serial.js';
import { zroundProtocol } from './link/zround.js';

const encode = (line) => new TextEncoder().encode(line);

export class Bridge extends EventTarget {
  #replies = [];
  #helloTimer = null;
  #retryTimer = null;
  #flushing = null;
  #again = false;
  #closed = false;
  /** The last %T…& clock the decoder sent. @type {number | null} */
  #clock = null;
  /** @type {any} */ transport;
  /** @type {any} */ protocol;
  /** @type {any} */ device;
  /** @type {any} */ port;
  /** @type {ReturnType<typeof import('./outbox.js').memoryOutbox>} */ outbox;
  /** @type {(decoderId: string, batch: any) => Promise<{ through: number | null }>} */ post;
  /** @type {number} */ helloMs;
  /** @type {number} */ retryMs;
  /** @type {number} */ replyMs;

  /**
   * @param {{ link?: { transport: any, protocol: any } | null, port?: any, outbox: ReturnType<typeof import('./outbox.js').memoryOutbox>,
   *   post: (decoderId: string, batch: { boot: string, passings: { transponder: string, t: number }[] }) => Promise<{ through: number | null }>,
   *   helloMs?: number, retryMs?: number, replyMs?: number }} options
   */
  constructor({ link = null, port = null, outbox, post, helloMs = 2000, retryMs = 5000, replyMs = 3000 }) {
    super();
    const { transport, protocol } = link ?? { transport: serialTransport(port), protocol: zroundProtocol() };
    Object.assign(this, { transport, protocol, port, outbox, post, helloMs, retryMs, replyMs });
    this.device = transport.device;
    this.state = 'idle';
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

  /** @param {Uint8Array} bytes */
  async #write(bytes) {
    await this.transport.write(bytes);
  }

  async start() {
    await this.transport.open({ baudRate: this.protocol.baudRate });
    void this.#read();
    await this.hello();
    void this.flush();
  }

  /** Asks the decoder who it is; no answer in time means it isn't a TinyLap decoder. */
  async hello() {
    this.#set('connecting');
    clearTimeout(this.#helloTimer);
    this.#helloTimer = setTimeout(() => {
      if (this.state === 'connecting') this.#set('not-tinylap');
    }, this.helloMs);
    await this.#write(encode(commands.hello));
  }

  async #read() {
    try {
      for await (const bytes of this.transport.bytes()) {
        for (const event of this.protocol.push(bytes)) {
          try {
            await this.#handle(event);
          } catch (error) {
            // A handler failure (say the outbox can't store) is not a lost port: say so and keep reading.
            this.#setOnline(false, error);
          }
        }
      }
    } finally {
      clearTimeout(this.#helloTimer);
      if (!this.#closed) this.#set('disconnected');
    }
  }

  async #handle(message) {
    if (message.type === 'identity') {
      clearTimeout(this.#helloTimer);
      if (message.boot !== this.boot) {
        this.references.clear();
        this.#clock = null;
      }
      this.decoder = message.decoder;
      this.boot = message.boot;
      this.#set(message.decoder ? 'ready' : 'unpaired');
      if (message.decoder) void this.flush();
    } else if (message.type === 'clock') {
      // A clock that went back means the decoder rebooted (power, %I&) with the port open: ask who it is now.
      const back = this.#clock !== null && message.t < this.#clock;
      this.#clock = message.t;
      if (back) await this.hello();
    } else if (message.type === 'ok' || message.type === 'error') {
      this.#replies.shift()?.(message);
    } else if (message.type === 'passing' && this.state === 'ready') {
      const passing = { decoder: this.decoder, boot: this.boot, transponder: message.transponder, t: message.t };
      const step = nextLap(this.references.get(message.transponder) ?? null, { boot: this.boot, t: message.t });
      this.references.set(message.transponder, step.reference);
      await this.outbox.add(passing);
      this.dispatchEvent(new CustomEvent('passing', { detail: { ...passing, lapMs: step.kind === 'lap' ? step.ms : null } }));
      void this.flush();
    }
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
    clearTimeout(this.#helloTimer);
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

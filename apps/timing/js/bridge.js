// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bridge (spec §5): a decoder on USB, read with Web Serial, forwarded
// to the server with the member's session. It asks the decoder who it is
// (%TLHELLO&), so its passings carry the same key as the copies the decoder
// sends over Wi-Fi, pairs unpaired decoders, keeps an outbox while offline,
// and computes laps locally for an instant preview.
import { MAX_BATCH, ZROUND_BAUD, commands, createReader, nextLap } from '@tinylap/timing';

export class Bridge extends EventTarget {
  #replies = [];
  #helloTimer = null;
  #retryTimer = null;
  #flushing = null;
  #again = false;
  #writer = null;
  #reader = null;
  #closed = false;
  /** @type {any} */ port;
  /** @type {ReturnType<typeof import('./outbox.js').memoryOutbox>} */ outbox;
  /** @type {(decoderId: string, batch: any) => Promise<{ through: number | null }>} */ post;
  /** @type {number} */ helloMs;
  /** @type {number} */ retryMs;
  /** @type {number} */ replyMs;

  /**
   * @param {{ port: any, outbox: ReturnType<typeof import('./outbox.js').memoryOutbox>,
   *   post: (decoderId: string, batch: { boot: string, passings: { transponder: string, t: number }[] }) => Promise<{ through: number | null }>,
   *   helloMs?: number, retryMs?: number, replyMs?: number }} options
   */
  constructor({ port, outbox, post, helloMs = 2000, retryMs = 5000, replyMs = 3000 }) {
    super();
    Object.assign(this, { port, outbox, post, helloMs, retryMs, replyMs });
    this.state = 'idle';
    this.decoder = null;
    this.boot = null;
    this.online = true;
    this.lastError = null;
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

  async #write(line) {
    await this.#writer.write(new TextEncoder().encode(line));
  }

  async start() {
    await this.port.open({ baudRate: ZROUND_BAUD });
    this.#writer = this.port.writable.getWriter();
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
    await this.#write(commands.hello);
  }

  async #read() {
    const lines = createReader();
    const text = new TextDecoder();
    this.#reader = this.port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this.#reader.read();
        if (done) break;
        for (const message of lines.push(text.decode(value, { stream: true }))) {
          try {
            await this.#handle(message);
          } catch (error) {
            // A handler failure (say the outbox can't store) is not a lost port: say so and keep reading.
            this.#setOnline(false, error);
          }
        }
      }
    } catch {
      // The port went away; answered below.
    } finally {
      this.#reader.releaseLock();
      try {
        this.#writer?.releaseLock();
      } catch {
        // Already released.
      }
      clearTimeout(this.#helloTimer);
      if (!this.#closed) this.#set('disconnected');
    }
  }

  async #handle(message) {
    if (message.type === 'hello') {
      clearTimeout(this.#helloTimer);
      if (message.boot !== this.boot) this.references.clear();
      this.decoder = message.decoder;
      this.boot = message.boot;
      this.#set(message.decoder ? 'ready' : 'unpaired');
      if (message.decoder) void this.flush();
    } else if (message.type === 'ok' || message.type === 'error') {
      this.#replies.shift()?.(message);
    } else if (message.type === 'lap' && this.state === 'ready') {
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
      const timer = setTimeout(() => reject(new Error("The decoder didn't answer.")), this.replyMs);
      this.#replies.push((message) => {
        clearTimeout(timer);
        if (message.type === 'ok') resolve(message);
        else reject(new Error(`The decoder said: ${message.text}`));
      });
    });
  }

  /** Stores the decoder's id and token on the board (and Wi-Fi, if given), then asks again who it is. */
  async pair(decoderId, token, wifi = null) {
    let reply = this.#reply();
    await this.#write(commands.pair(decoderId, token));
    await reply;
    if (wifi) {
      reply = this.#reply();
      await this.#write(commands.wifi(wifi.ssid, wifi.password));
      await reply;
    }
    await this.hello();
  }

  /** Sends the outbox, one decoder and boot at a time; retries later when the server can't be reached. */
  flush() {
    if (this.#flushing) {
      this.#again = true;
      return this.#flushing;
    }
    clearTimeout(this.#retryTimer);
    this.#flushing = (async () => {
      try {
        // Groups the server refused for good (a 4xx) stay in the outbox but must not block the others.
        const refused = new Set();
        let refusal = null;
        for (;;) {
          const items = (await this.outbox.list()).filter((p) => !refused.has(`${p.decoder} ${p.boot}`));
          if (items.length === 0) break;
          const [first] = items;
          const group = items.filter((p) => p.decoder === first.decoder && p.boot === first.boot).sort((a, b) => a.t - b.t).slice(0, MAX_BATCH);
          let through;
          try {
            ({ through } = await this.post(first.decoder, { boot: first.boot, passings: group.map(({ transponder, t }) => ({ transponder, t })) }));
          } catch (error) {
            const status = /** @type {any} */ (error)?.status;
            if (typeof status !== 'number' || status < 400 || status > 499 || status === 429) throw error;
            refused.add(`${first.decoder} ${first.boot}`);
            refusal = error;
            this.lastError = error;
            continue;
          }
          await this.outbox.removeThrough(first.decoder, first.boot, through ?? -1);
          this.#setOnline(true);
          this.dispatchEvent(new Event('outbox'));
          // The server stores what it is sent, so `through` covers the group; if not, stop rather than loop.
          if (through === null || through < group.at(-1).t) break;
        }
        if (refusal) this.lastError = refusal;
      } catch (error) {
        this.#setOnline(false, error);
        this.#retryTimer = setTimeout(() => void this.flush(), this.retryMs);
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
    await this.#reader?.cancel().catch(() => {});
    this.#writer?.releaseLock();
    await this.port.close().catch(() => {});
  }
}

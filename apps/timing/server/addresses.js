// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Where a decoder can reach this server over Wi-Fi (dev decoder address spec): on a
// decoder, localhost is the decoder itself.
import { networkInterfaces } from 'node:os';

/** This machine's address on the network: the first IPv4 that isn't internal, or null. */
export function lanAddress(interfaces = networkInterfaces()) {
  for (const list of Object.values(interfaces)) {
    const found = list?.find((i) => i.family === 'IPv4' && !i.internal);
    if (found) return found.address;
  }
  return null;
}

/** Whether a URL names this machine only (localhost, 127.0.0.0/8, [::1]): a decoder can't post to it. @param {string} url */
export function isLoopback(url) {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

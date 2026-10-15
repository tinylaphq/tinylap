// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export class ApiError extends Error {
  /** @param {number} status @param {any} problem RFC 9457 body, or null */
  constructor(status, problem) {
    super(problem?.detail ?? `The server answered ${status}.`);
    this.status = status;
    this.problem = problem;
  }
}

/** A same-origin JSON call. @param {string} method @param {string} path @param {unknown} [body] */
export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

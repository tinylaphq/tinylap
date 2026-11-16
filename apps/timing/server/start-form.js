// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The board's Start form, server side (board hub spec §5, §8): each kind's
// defaults from the last session of that kind, and a reader that takes only
// the sent kind's own fields. A kind's fields are named after it:
//   race-drivers (everyone | chosen), race-roster (one per driver),
//   race-minutes, race-countdown; qualifying-drivers, qualifying-roster,
//   qualifying-minutes. A practice has none.
// Every value is kept as the form sent it (strings), so a 422 can show it again.
import * as ops from './operations.js';

/** @typedef {'everyone' | 'chosen'} DriversMode */
/**
 * One kind's settings as the form shows them. `earlier` says whether a session of the kind came before, which
 * picks the button's hint ("Same drivers and length as the last qualifying." or what the kind does).
 * @typedef {{ drivers: DriversMode, roster: string[], minutes: string, countdown?: string, earlier: boolean }} KindSettings
 */
/**
 * @typedef {{ kind: 'practice' | 'qualifying' | 'race', practice: { earlier: boolean }, qualifying: KindSettings, race: KindSettings }} StartDefaults
 */

const DEFAULT_MINUTES = 5;
const DEFAULT_COUNTDOWN = 10;
/** The kinds with settings, and their fields in the form's order. */
const SETTINGS = { qualifying: ['drivers', 'roster', 'minutes'], race: ['drivers', 'roster', 'minutes', 'countdown'] };
/** An operation's field, as the sent kind's form field. */
const FIELD_OF = { roster: 'roster', duration: 'minutes', countdown: 'countdown' };
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/**
 * Each kind's defaults from the last session of that kind (any state): its drivers (a roster is Chosen drivers,
 * none is Everyone on the track), its length in whole minutes and, for a race, its countdown. Without one: Everyone
 * on the track, 5 min, 10 s. The roster keeps only drivers still here; when none is left, or the session had none,
 * it is every driver, so Chosen drivers opens with all of them ticked. `kind` is the last session's kind, Practice
 * when there is none.
 * @param {any} request @returns {StartDefaults}
 */
export function startDefaults(request) {
  const { store, workspaceId: ws } = request;
  const ids = store.drivers(ws).map((d) => d.id);
  const lastOf = { practice: store.lastSessionOf(ws, 'practice'), qualifying: store.lastSessionOf(ws, 'qualifying'), race: store.lastSessionOf(ws, 'race') };
  /** @param {'qualifying' | 'race'} kind @returns {KindSettings} */
  const settingsOf = (kind) => {
    const last = lastOf[kind];
    const kept = (last?.roster ?? []).filter((id) => ids.includes(id));
    const minutes = last?.durationMs ? clamp(Math.round(last.durationMs / 60_000), 1, 60) : DEFAULT_MINUTES;
    const settings = { drivers: /** @type {DriversMode} */ (kept.length ? 'chosen' : 'everyone'), roster: kept.length ? kept : ids, minutes: String(minutes), earlier: last !== null };
    if (kind !== 'race') return settings;
    // A race opens its countdown after it was created.
    const countdown = last && last.opensAt !== null ? clamp(Math.round((last.opensAt - last.createdAt) / 1000), 0, 30) : DEFAULT_COUNTDOWN;
    return { ...settings, countdown: String(countdown) };
  };
  const latest = Object.values(lastOf).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt)[0];
  return { kind: latest?.kind ?? 'practice', practice: { earlier: lastOf.practice !== null }, qualifying: settingsOf('qualifying'), race: settingsOf('race') };
}

/**
 * Reads a sent Start form: `kind`, then only that kind's own fields; another kind's are never read. A missing
 * `<kind>-drivers` is Everyone on the track; a blank length or countdown is the operation's default.
 *
 * - `args`: for `ops.startSession` (add `replace`).
 * - `errors`: every field's error at once, in the form's order, each with `field` the form field's name
 *   (`kind`, `race-drivers`, `race-roster`, `race-minutes`, `race-countdown`, or `qualifying-…`).
 * - `values`: what was sent, to show again on a 422: `{ kind, [kind]: { drivers, roster, minutes, countdown? } }`;
 *   lay it over `startDefaults` for the other kinds.
 * - `fields`: the sent fields as [name, value] pairs, for a confirm page to send again.
 * @param {any} request @param {{ get(name: string): any, getAll(name: string): any[] }} form
 */
export function readStart(request, form) {
  const sent = form.get('kind');
  const kind = typeof sent === 'string' ? sent : '';
  if (kind !== 'qualifying' && kind !== 'race') {
    const args = { kind };
    const errors = ops.startErrors(request, { ...args, roster: undefined, durationSeconds: undefined, countdownSeconds: undefined });
    return { kind, args, errors, values: { kind }, fields: [['kind', kind]] };
  }
  const name = (field) => `${kind}-${field}`;
  const text = (field) => {
    const value = form.get(name(field));
    return typeof value === 'string' ? value : '';
  };
  const drivers = form.get(name('drivers')) ?? 'everyone';
  const roster = form.getAll(name('roster')).filter((id) => typeof id === 'string');
  const minutes = text('minutes');
  const countdown = kind === 'race' ? text('countdown') : undefined;
  const errors = [];
  if (drivers !== 'everyone' && drivers !== 'chosen') errors.push(ops.fail('invalid-request', 'Pick Everyone on the track or Chosen drivers.', name('drivers')).error);
  // The box takes whole minutes, as its min and max say: plain digits only, not "1e1" or "0x10".
  const wholeMinutes = minutes === '' ? undefined : /^[0-9]+$/.test(minutes) ? Number(minutes) : NaN;
  const badMinutes = wholeMinutes !== undefined && !(Number.isInteger(wholeMinutes) && wholeMinutes >= 1 && wholeMinutes <= 60);
  if (badMinutes) errors.push(ops.fail('invalid-request', 'A session lasts 1 to 60 minutes.', name('minutes')).error);
  const args = {
    kind,
    roster: drivers === 'chosen' ? roster : undefined,
    durationSeconds: wholeMinutes === undefined || badMinutes ? undefined : wholeMinutes * 60,
    countdownSeconds: countdown === undefined || countdown === '' ? undefined : countdown,
  };
  for (const error of ops.startErrors(request, args)) errors.push({ ...error, field: name(FIELD_OF[error.field] ?? error.field) });
  const order = ['kind', ...SETTINGS[kind].map(name)];
  errors.sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
  const values = { drivers: String(drivers), roster, minutes, ...(countdown === undefined ? {} : { countdown }) };
  /** @type {[string, string][]} */
  const fields = [['kind', kind], [name('drivers'), String(drivers)], ...roster.map((id) => /** @type {[string, string]} */ ([name('roster'), id])), [name('minutes'), minutes]];
  if (countdown !== undefined) fields.push([name('countdown'), countdown]);
  return { kind, args, errors, values: { kind, [kind]: values }, fields };
}

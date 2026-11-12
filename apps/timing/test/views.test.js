// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { Html, html, safe } from '../server/views/html.js';
import { copyable, selectField, textField } from '../server/views/form-parts.js';
import { clockOf } from '../server/views/board.js';
import { notFoundPage, startPage } from '../server/views/notice.js';
import { chip, idleNotice, marks, marksHead, timeWidths } from '../server/views/marks.js';
import { directionIcon } from '../server/views/direction.js';
import { shortLength } from '../server/views/sessions.js';
import { decoderCards, wifiDialog } from '../server/views/bridge.js';
import { formatWhen } from '../public/format.js';

test('interpolations are escaped', () => {
  const name = `<b>Ana</b> & "Ben" 'C'`;
  assert.equal(String(html`<li title="${name}">${name}</li>`),
    '<li title="&lt;b&gt;Ana&lt;/b&gt; &amp; &quot;Ben&quot; &#39;C&#39;">&lt;b&gt;Ana&lt;/b&gt; &amp; &quot;Ben&quot; &#39;C&#39;</li>');
});

test('templates nest, arrays join, empties vanish', () => {
  const items = ['a<', 'b'].map((x) => html`<li>${x}</li>`);
  assert.equal(String(html`<ul>${items}${null}${undefined}${false}</ul>`), '<ul><li>a&lt;</li><li>b</li></ul>');
  assert.equal(String(html`${0} ${''}`), '0 ');
  assert.ok(html`x` instanceof Html);
});

test('safe() passes trusted markup through', () => {
  assert.equal(String(html`<p>${safe('<br>')}</p>`), '<p><br></p>');
  assert.equal(safe('<i>').text, '<i>');
  assert.equal(String(html`<p>${safe(null)}${safe(undefined)}</p>`), '<p></p>');
});

test('made markup cannot be changed afterwards', () => {
  for (const made of [html`<p>x</p>`, safe('<p>x</p>')]) {
    assert.ok(Object.isFrozen(made));
    assert.throws(() => { made.text = '<script>'; }, TypeError);
    assert.equal(String(made), '<p>x</p>');
  }
});

test('fields escape their values and mark their errors', () => {
  const out = String(textField({ id: 'n', label: 'Name', name: 'name', value: '"><script>', error: { field: 'name', message: 'Too <long>' } }));
  assert.match(out, /value="&quot;&gt;&lt;script&gt;"/);
  assert.match(out, /aria-invalid="true" aria-describedby="n-error"/);
  assert.match(out, /<p class="field-error" id="n-error">Too &lt;long&gt;<\/p>/);
});

test('the clock for each state, on the server', () => {
  const race = { kind: 'race', opensAt: 10_000, closesAt: 310_000 };
  assert.equal(clockOf(null, 0), null);
  assert.deepEqual(clockOf({ kind: 'practice', state: 'running', opensAt: 1000 }, 61_000), { label: 'Started', ms: 60_000 });
  assert.deepEqual(clockOf({ kind: 'practice', state: 'done', opensAt: 1000 }, 61_000), { label: 'Ended', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'countdown' }, 5000), { label: 'Starts in', ms: 5000 });
  assert.deepEqual(clockOf({ ...race, state: 'running' }, 70_000), { label: 'Remaining', ms: 240_000 });
  assert.deepEqual(clockOf({ ...race, state: 'finishing' }, 400_000), { label: 'Last lap', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'aborted' }, 400_000), { label: 'Aborted', ms: 0 });
  assert.deepEqual(clockOf({ ...race, state: 'done' }, 400_000), { label: 'Finished', ms: 0 });
});

test('a copyable value: the Copy button and its hint are hidden until tl-copy shows them', () => {
  const out = String(copyable(html`<code class="token">abc</code>`));
  assert.match(out, /^<tl-copy class="copy"><code class="token">abc<\/code>/);
  assert.match(out, /<button type="button" class="btn btn-outline" hidden>Copy<\/button>/);
  assert.match(out, /<span class="visually-hidden" role="status"><\/span>/);
  assert.match(out, /<p class="field-hint copy-hint" hidden>Select it and copy it yourself\.<\/p>/);
});

test('a copyable field wraps its input, not its label', () => {
  const out = String(textField({ id: 'w', label: 'Link', name: 'link', value: 'https://x', readonly: true, copy: true }));
  assert.match(out, /<label for="w">Link<\/label>\s*<tl-copy class="copy"><input type="text" id="w"[^>]*readonly>/);
});

test('signed out, the start page has one Sign in, in its card; other pages keep the navbar one', () => {
  const signedOut = (path) => ({ session: null, url: new URL(path, 'https://timing.example') });
  const start = String(startPage(signedOut('/')));
  assert.equal(start.match(/>Sign in</g)?.length, 1);
  assert.match(start, /<a class="btn btn-primary" href="\/auth\/login\?returnTo=%2F">Sign in<\/a>/);
  assert.doesNotMatch(start, /nav-sign-in/);
  assert.match(String(notFoundPage(signedOut('/nope'))), /<a class="btn btn-sm btn-outline nav-sign-in" href="\/auth\/login\?returnTo=%2Fnope">Sign in<\/a>/);
});

test('selectField without a hint or data-name renders as it always has', () => {
  const options = [{ value: 'cw', label: 'Clockwise' }, { value: 'ccw', label: 'Counter-clockwise' }];
  assert.equal(String(selectField({ id: 'x', label: 'Direction', name: 'direction', options, value: 'cw' })),
    '<div class="field">\n  <label for="x">Direction</label>\n  <select id="x" name="direction">\n    <option value="cw" selected>Clockwise</option><option value="ccw">Counter-clockwise</option>\n  </select>\n  \n</div>');
  assert.equal(String(selectField({ id: 'x', label: 'Direction', name: 'direction', options, value: 'cw', error: { field: 'direction', message: 'Pick one.' } })),
    '<div class="field">\n  <label for="x">Direction</label>\n  <select id="x" name="direction" aria-invalid="true" aria-describedby="x-error">\n    <option value="cw" selected>Clockwise</option><option value="ccw">Counter-clockwise</option>\n  </select>\n  <p class="field-error" id="x-error">Pick one.</p>\n</div>');
});

test('a mark is a cell of its own after the time, empty or not; a record lap shows TR, not PB too', () => {
  assert.equal(String(marks({ lapMs: 7000, isRecord: false, isPb: false })), '<td class="mark-cell"></td>');
  assert.equal(String(marks({ lapMs: 7000, isRecord: false, isPb: true })), '<td class="mark-cell"><abbr class="mark mark-pb" title="Personal best" aria-hidden="true">PB</abbr><span class="visually-hidden">Personal best</span></td>');
  assert.equal(String(marks({ lapMs: 7000, isRecord: true, isPb: true })), '<td class="mark-cell"><abbr class="mark mark-tr" title="Track record" aria-hidden="true">TR</abbr><span class="visually-hidden">Track record</span></td>');
  assert.equal(String(marks({ lapMs: null, isRecord: true, isPb: true })), '<td class="mark-cell"></td>', 'no lap, no mark');
  assert.equal(String(marks({ lapMs: 7000, isRecord: false, isPb: true }, { list: true, note: 'Session best' })), '<span class="mark-cell"><abbr class="mark mark-pb" title="Personal best" aria-hidden="true">PB</abbr><span class="visually-hidden">Personal best</span>Session best</span>', 'in a list, a span, with its note after');
  assert.equal(String(marksHead), '<th scope="col" class="mark-cell"><span class="visually-hidden">Mark</span></th>');
  const drivers = [{ id: 'c', name: 'Cyrille Featherstonehaugh', colour: '#f5a623' }];
  assert.equal(String(chip(drivers, 'c')), '<span class="driver" style="--driver: #f5a623"><span class="driver-name" title="Cyrille Featherstonehaugh">Cyrille Featherstonehaugh</span></span>');
  assert.equal(String(chip(drivers, 'c', { holder: true })), '<span class="driver" style="--driver: #f5a623"><span class="crown" role="img" aria-label="Track record holder" title="Track record holder">👑</span><span class="driver-name" title="Cyrille Featherstonehaugh">Cyrille Featherstonehaugh</span></span>', 'the crown before the name, the full name in its title');
  assert.equal(String(chip(drivers, 'gone')), '<span class="driver"><span class="driver-name" title="Former driver">Former driver</span></span>');
  assert.equal(String(chip(drivers, null)), '<span class="driver"><span class="driver-name" title="Unknown car">Unknown car</span></span>');
});

test('time columns widen only for a lap of a minute or a total of ten minutes', () => {
  assert.equal(timeWidths([8123, null, undefined, 59_999], [599_999]), '');
  assert.equal(timeWidths([8123, 60_000]), ' has-minute-laps');
  assert.equal(timeWidths([8123], [600_000]), ' has-long-totals');
  assert.equal(timeWidths([60_000], [845_000]), ' has-minute-laps has-long-totals');
});

test('a car with no session running is a live line, by its driver, or by its code without one', () => {
  const drivers = [{ id: 'h', name: 'Haris', colour: '#1e88e5' }];
  assert.equal(idleNotice(null, drivers), null);
  assert.equal(String(idleNotice({ transponder: '23', driverId: 'h', at: 1 }, drivers)), '<p class="board-on-track" role="status"><span><span class="driver" style="--driver: #1e88e5"><span class="driver-name" title="Haris">Haris</span></span> is on the track</span></p>');
  assert.equal(String(idleNotice({ transponder: '23', driverId: 'gone', at: 1 }, drivers)), '<p class="board-on-track" role="status"><span>Transponder 23 is on the track</span></p>', 'a driver since deleted: the code');
  assert.match(String(idleNotice({ transponder: '<b>', driverId: null, at: 1 }, drivers)), /Transponder &lt;b&gt; is on the track/);
});

test('the direction icon: an open loop with one arrowhead, named by its own title', () => {
  for (const [direction, name] of [['ccw', 'Anticlockwise'], ['cw', 'Clockwise']]) {
    const svg = String(directionIcon(direction));
    assert.match(svg, new RegExp(`^<svg class="direction-icon" width="40" height="22" viewBox="0 0 40 22" role="img"><title>${name}</title>`));
    assert.equal(svg.match(/<path /g).length, 2, 'the loop and its arrowhead');
    assert.match(svg, /stroke="var\(--p-accent-1\)"/);
  }
  assert.notEqual(String(directionIcon('cw')), String(directionIcon('ccw')));
});

test('a short length rounds to whole seconds first, so 59.6 s reads "1 min", never "60 s"', () => {
  assert.equal(shortLength(18_400), '18 s');
  assert.equal(shortLength(59_400), '59 s');
  assert.equal(shortLength(59_600), '1 min');
  assert.equal(shortLength(60_000), '1 min');
  assert.equal(shortLength(12 * 60_000 + 59_000), '12 min');
});

// The Bridge page's decoder cards (connections spec §2, §2.1, §3) and the Change Wi-Fi dialog (§5).
const T = Date.UTC(2026, 10, 10, 14, 31);
const bridgeRequest = { now: () => T };
const row = (id, name, cable, wifi, at = null, lastSeenAt = null) => ({ id, name, createdAt: 1, lastSeenAt, cable: { state: cable }, wifi: { state: wifi, at } });
const cardOf = (out, id) => new RegExp(`<section class="card-static decoder-card" data-decoder="${id}">([\\s\\S]*?)</section>`).exec(out)?.[1];
const rowOf = (card, which) => new RegExp(`<li class="decoder-row" data-row="${which}">([\\s\\S]*?)</li>`).exec(card)?.[1];
const slot = (part, name) => new RegExp(`data-slot="${name}">([\\s\\S]*?)</${name === 'status' || name === 'action' ? 'div' : 'p'}>`).exec(part)?.[1];
const lamp = (part) => /<span class="lamp" data-state="([a-z]+)"/.exec(part)?.[1];

test('decoder cards: every server state in its words, lamp and action (connections spec §2.1, §3)', () => {
  const out = String(decoderCards(bridgeRequest, [
    row('never', 'Never', 'none', 'unknown'),
    row('rep', 'Reporting', 'none', 'reporting', T - 5000, T - 5000),
    row('idle', 'Idle', 'none', 'idle', T - 600_000, T - 600_000),
    row('off', 'Offline', 'none', 'offline', T - 120_000, T - 120_000),
    row('silent', 'Silent', 'none', 'unknown', null, T - 3 * 86_400_000),
    row('other', 'Other', 'other', 'unknown', null, T - 5000),
    row('both', 'Both', 'other', 'reporting', T - 5000, T - 5000),
  ], { mayPair: true }));
  const iso = (ms) => new Date(ms).toISOString();

  const never = cardOf(out, 'never');
  assert.equal(slot(never, 'status'), "<p>If it's on, its laps wait on it. Connect the cable to see why.</p><p>Never heard.</p>");
  assert.match(never, /<div class="status status-warning" data-slot="status">/);
  assert.equal(lamp(rowOf(never, 'cable')), 'off');
  assert.equal(slot(rowOf(never, 'cable'), 'state'), 'Not connected');
  assert.equal(slot(rowOf(never, 'cable'), 'detail'), 'Plug the decoder in by USB, then connect it.');
  assert.match(slot(rowOf(never, 'cable'), 'action'), /^<button type="button" class="btn btn-sm btn-primary" data-bridge-connect="serial">Connect decoder<\/button>$/, 'primary while laps wait');
  assert.equal(lamp(rowOf(never, 'wifi')), 'unknown');
  assert.equal(slot(rowOf(never, 'wifi'), 'state'), '', 'no state claimed');
  assert.equal(slot(rowOf(never, 'wifi'), 'detail'), 'Connect the cable to see its Wi-Fi.');

  const rep = cardOf(out, 'rep');
  assert.match(rep, /<div class="status status-success" data-slot="status"><p>Laps get through over Wi-Fi\.<\/p><\/div>/);
  assert.equal(slot(rowOf(rep, 'cable'), 'detail'), 'Not needed while Wi-Fi works.');
  assert.match(slot(rowOf(rep, 'cable'), 'action'), /class="btn btn-sm btn-outline" data-bridge-connect="serial">Connect decoder</, 'outline while Wi-Fi works');
  assert.equal(lamp(rowOf(rep, 'wifi')), 'ok');
  assert.equal(slot(rowOf(rep, 'wifi'), 'state'), 'Reporting');
  assert.equal(slot(rowOf(rep, 'wifi'), 'detail'), `Last heard <time datetime="${iso(T - 5000)}" data-when>just now</time>.`);
  assert.match(slot(rowOf(rep, 'wifi'), 'action'), /^<p class="decoder-row-help">Connect the cable to see and change its Wi-Fi\.<\/p><button type="button" class="btn btn-sm btn-outline" data-bridge-wifi hidden>Change Wi-Fi<\/button>$/, 'no Change Wi-Fi without the cable');

  const idle = cardOf(out, 'idle');
  assert.match(idle, /data-slot="status"><p>Laps get through over Wi-Fi\.<\/p>/);
  assert.equal(lamp(rowOf(idle, 'wifi')), 'idle');
  assert.equal(slot(rowOf(idle, 'wifi'), 'state'), 'Idle');
  assert.equal(slot(rowOf(idle, 'wifi'), 'detail'), 'Wakes up with the next lap.');
  assert.match(slot(rowOf(idle, 'cable'), 'action'), /btn-outline/);

  const off = cardOf(out, 'off');
  assert.match(off, /status-warning/);
  assert.equal(slot(off, 'status'), `<p>If it's on, its laps wait on it. Connect the cable to see why.</p><p>Last heard <time datetime="${iso(T - 120_000)}" data-when>2 min ago</time>.</p>`);
  assert.equal(lamp(rowOf(off, 'wifi')), 'fail');
  // The spec's words, with the time of day until the browser writes it in its zone; the status line says "Last heard".
  assert.equal(slot(rowOf(off, 'wifi'), 'state'), `Not reporting since <time datetime="${iso(T - 120_000)}" data-when>${formatWhen(T - 120_000, T)}</time>`);
  assert.equal(slot(rowOf(off, 'wifi'), 'detail'), '', 'no second "Last heard" in the row');
  assert.equal(slot(rowOf(off, 'cable'), 'detail'), 'Plug the decoder in by USB, then connect it.');
  // What tl-bridge shows after this tab's cable to it was pulled, hidden until then.
  assert.match(rowOf(off, 'cable'), /<p class="decoder-row-help" data-cable-note="back" hidden>It reconnects when you plug it back in\.<\/p><p class="decoder-row-help" data-cable-note="gap" hidden>Crossings while it is unplugged are lost, and each car's lap starts over when you connect again\.<\/p>/);
  assert.match(slot(rowOf(off, 'cable'), 'action'), /btn-primary/);

  const silent = cardOf(out, 'silent');
  assert.match(slot(silent, 'status'), new RegExp(`<p>Last heard <time datetime="${iso(T - 3 * 86_400_000)}" data-when>`));
  assert.equal(lamp(rowOf(silent, 'wifi')), 'unknown');

  const other = cardOf(out, 'other');
  assert.match(other, /data-slot="status"><p>Laps get through over the cable\.<\/p>/);
  assert.equal(lamp(rowOf(other, 'cable')), 'ok');
  assert.equal(slot(rowOf(other, 'cable'), 'state'), 'Connected on another laptop');
  assert.match(slot(rowOf(other, 'cable'), 'action'), /btn-outline" data-bridge-connect="serial">Connect decoder</, 'another laptop may be this one before a reload');
  assert.ok(rowOf(other, 'wifi'), 'a decoder that may be a plain ZRound keeps its Wi-Fi row until this tab\'s cable says otherwise');
  assert.equal(slot(rowOf(other, 'wifi'), 'detail'), 'Connect the cable to see its Wi-Fi.');

  assert.match(cardOf(out, 'both'), /data-slot="status"><p>Laps get through over the cable and Wi-Fi\.<\/p>/);
});

test('decoder cards: by name; Change Wi-Fi only for members who may pair; an empty club can still connect', () => {
  const rows = [row('b', 'Zeta', 'none', 'reporting', T, T), row('a', 'alpha <1>', 'none', 'unknown'), row('c', 'Mid', 'none', 'idle', T, T)];
  const out = String(decoderCards(bridgeRequest, rows, { mayPair: true }));
  assert.match(out, /^<div id="bridge-decoders">/);
  assert.deepEqual([...out.matchAll(/data-decoder="([^"]+)"/g)].map((m) => m[1]), ['a', 'c', 'b']);
  assert.match(out, /<h2 class="h3 cut-words" data-slot="name">alpha &lt;1&gt;<\/h2>/);
  assert.equal(out.match(/data-bridge-wifi/g).length, 3, 'one per card, all hidden');
  const run = String(decoderCards(bridgeRequest, rows, { mayPair: false }));
  assert.doesNotMatch(run, /data-bridge-wifi|Change Wi-Fi/);
  assert.doesNotMatch(run, /see and change/);
  assert.match(slot(rowOf(cardOf(run, 'b'), 'wifi'), 'action'), /^<p class="decoder-row-help">Connect the cable to see its Wi-Fi\.<\/p>$/);
  const empty = String(decoderCards(bridgeRequest, [], { mayPair: true }));
  assert.match(empty, /<div id="bridge-decoders">\s*<section class="card-static decoder-empty">\s*<p>No decoder yet\. Plug one in by USB, then connect it to pair it\.<\/p>\s*<p><button type="button" class="btn btn-primary" data-bridge-connect="serial">Connect decoder<\/button><\/p>/);
  assert.doesNotMatch(empty, /data-decoder=/);
});

test('the Change Wi-Fi dialog: closed, one hidden step each, in the spec\'s words (connections spec §5)', () => {
  const out = String(wifiDialog());
  assert.match(out, /^<dialog id="wifi-dialog" class="wifi-dialog" aria-labelledby="wifi-title-looking">/);
  assert.doesNotMatch(out, /<dialog[^>]* open/);
  const steps = [...out.matchAll(/<(?:section|form) class="wifi-step" data-step="([a-z]+)"[^>]*hidden/g)].map((m) => m[1]);
  assert.deepEqual(steps, ['looking', 'list', 'password', 'another', 'joining', 'result']);
  for (const words of [
    'Looking for networks near the decoder…', 'Networks near the decoder', '>Look again<', 'Only 2.4 GHz networks show here.',
    '>Another network…<', '>Back to the list<', '>Join network<',
    'Exactly as it is written, capitals included.', 'Leave empty for an open network.', '>Done<',
    'Laps now also get through over Wi-Fi.', "The decoder didn't answer",
    'TinyLap never sees the password: it goes from this laptop straight to the decoder.',
  ]) assert.ok(out.includes(words), words);
  assert.equal(out.match(/TinyLap never sees the password/g).length, 1, 'said once');
  assert.doesNotMatch(out, /Not in the list/, 'the button says it');
  // The two notes together, muted, under the list.
  assert.match(out, /<ul class="nets-list"[^>]*><\/ul>[\s\S]*?<div class="wifi-notes"><p class="wifi-hint">Only 2\.4 GHz networks show here\.<\/p><p class="wifi-hint">TinyLap never sees the password: it goes from this laptop straight to the decoder\.<\/p><\/div>/);
  // A typed network's failure comes back on its own step, above its fields.
  assert.match(out, /data-step="another"[\s\S]*?<p class="status status-error" role="alert" data-slot="error" hidden><\/p>\s*<div class="field">\s*<label for="wifi-another-name">/);
  assert.match(out, /<template data-wifi-row><li><button type="button" class="net" data-signal="">/);
  assert.match(out, /^<dialog [^>]*>\s*<p class="visually-hidden" role="status" data-wifi-live><\/p>/, 'its own live region: showModal makes the page inert');
  assert.match(out, /<p class="status status-error" role="alert" data-scan="failed" hidden>The decoder couldn't look for networks\. Look again\.<\/p>/);
  assert.match(out, /<p class="wifi-empty" data-scan="empty" hidden>No networks near the decoder\. Look again, or enter another network\.<\/p>/);
  assert.match(out, /<ul class="nets-list" data-slot="networks" aria-labelledby="wifi-nets-title"><\/ul>/, 'its rows are buttons: no tab stop of its own');
  // Never sent to the server: a submit that slips past the client closes the dialog, nothing in a URL.
  assert.deepEqual([...out.matchAll(/<form ([^>]*)>/g)].map((m) => /method="dialog"/.test(m[1])), [true, true]);
  assert.match(out, /<input type="text" id="wifi-another-name" name="ssid" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="wifi-another-name-hint">/);
  // The Show button inside the password field: palace's .input-action, a real button, no aria-pressed.
  assert.equal(out.match(/<div class="input-action"><input type="password"/g).length, 2);
  assert.match(out, /<button type="button" class="btn btn-sm btn-outline" data-wifi-show aria-controls="wifi-password" aria-label="Show password">Show<\/button>/);
  assert.doesNotMatch(out, /aria-pressed/);
  // One footer per step: the way back or aside on the left, the way on on the right (.wifi-menu-end), every button one size.
  const footers = [...out.matchAll(/<menu class="wifi-menu">([\s\S]*?)<\/menu>/g)].map((menu) => [...menu[1].matchAll(/<li( class="wifi-menu-end")?><button [^>]*class="btn ([a-z- ]+)"[^>]*>([^<]+)</g)].map((m) => `${m[1] ? 'end' : 'start'}:${m[2]}:${m[3]}`));
  assert.deepEqual(footers, [
    ['end:btn-outline:Cancel'],
    ['start:btn-outline:Another network…', 'end:btn-outline:Cancel'],
    ['start:btn-outline:Back to the list', 'end:btn-primary:Join network'],
    ['start:btn-outline:Back', 'end:btn-primary:Join network'],
    ['end:btn-outline:Cancel'],
    ['end:btn-primary:Done'],
  ]);
});

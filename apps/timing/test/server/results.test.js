// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A session's result on its page (board hub and results spec §6): the placed
// cards' facts per kind, the rest from 4 (a practice from 2), no time for a
// lapped car, the record that fell in a practice, the personal bests, the
// anchors to the lap cards, and the page's head and foot.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { resultOf, resultView } from '../../server/views/result.js';
import { clubNight } from './club-night.js';
import { startTiming, useTrack } from './helpers.js';

const clock = { now: Date.UTC(2026, 10, 16, 18, 0) };
let app;
let member;
let ws;
/** @type {Record<string, string>} */
let ids;
/** @type {Record<string, string>} */
let sessions;

before(async () => {
  app = await startTiming({ clock });
  const ana = await app.signUp('Ana');
  ws = app.club(ana, 'Kitchen').id;
  member = await app.login(ana);
  ({ ids, sessions } = await clubNight(app, clock, member, { ws, base: `/clubs/${ws}`, useTrack }));
});
after(() => app.close());

/** A session page's text, and its parts. */
async function pageOf(name) {
  const res = await app.api(member, 'GET', `/clubs/${ws}/sessions/${sessions[name]}`, undefined, { accept: 'text/html' });
  assert.equal(res.status, 200);
  const body = await res.text();
  const cards = [...body.matchAll(/<article class="place[^"]*">[\s\S]*?<\/article>/g)].map((m) => m[0]);
  const table = /<table class="board-table standings-table result-table[^"]*">[\s\S]*?<\/table>/.exec(body)?.[0] ?? '';
  const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1).map((m) => m[1]);
  /** A card's facts as label: value text. */
  const facts = (card) => Object.fromEntries([...card.matchAll(/<dt>([^<]+)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((m) => [m[1], visibleText(m[2]).replace(/\s+/g, ' ').trim()]));
  const head = [...table.matchAll(/<th scope="col"[^>]*>([^<]*)</g)].map((m) => m[1]).filter(Boolean);
  return { body, cards, table, rows, facts, head };
}
/** What a piece of markup reads as on screen, its tags gone (a mark's letters and its hidden name both stay). */
const visibleText = (markup) => markup.replace(/<[^>]+>/g, ' ');
const figure = (card) => visibleText(/<p class="place-figure">([\s\S]*?)<\/p>/.exec(card)[1]).replace(/\s+/g, ' ').trim();
const nameOf = (card) => /<h3 class="place-name">[\s\S]*?title="([^"]+)"/.exec(card)[1];

test('a race: the winner\'s total, Laps and Best lap; P2 and P3 by their gap with Time and Best lap; the rest from 4', async () => {
  const { cards, rows, facts, head } = await pageOf('race');
  assert.equal(cards.length, 3);
  assert.match(cards[0], /^<article class="place is-first">/);
  assert.deepEqual(cards.map(nameOf), ['Ana', 'Ben Okafor', 'Cyrille Featherstonehaugh']);
  assert.equal(figure(cards[0]), '50.277');
  assert.deepEqual(Object.keys(facts(cards[0])), ['Laps', 'Best lap']);
  assert.equal(facts(cards[0]).Laps, '7');
  assert.match(facts(cards[0])['Best lap'], /^7\.095 FL Fastest lap$/);
  assert.equal(figure(cards[1]), '+0.781');
  assert.deepEqual(facts(cards[1]), { Time: '51.058', 'Best lap': '7.154' });
  assert.deepEqual(head, ['Driver', 'Laps', 'Gap', 'Best lap', 'Time']);
  assert.equal(rows.length, 3, 'from 4');
  assert.match(rows[0], /<td class="pos">4<\/td>/);
  // Mia drove a lap fewer: Gap says so, and her shorter total is left out.
  const mia = rows[2];
  assert.match(mia, /title="Mia Schulz"/);
  assert.match(mia, /<td class="num gap">\+1 lap<\/td>/);
  assert.match(mia, /<td class="num v-total"><\/td>/);
  assert.match(rows[0], /<td class="num v-total">52\.400<\/td>/);
});

test('a lapped car on P2 or P3 has no Time fact', () => {
  const crossings = [];
  let seq = 0;
  for (const [driverId, n] of [['a', 3], ['b', 2]]) for (let i = 0; i < n; i++) crossings.push({ seq: ++seq, driverId, lapMs: 7000, counts: true, via: 'net', at: seq });
  const result = resultOf({
    session: { kind: 'race' },
    standings: [{ driverId: 'a', position: 1, laps: 3, bestMs: 7000, elapsedMs: 21_000 }, { driverId: 'b', position: 2, laps: 2, bestMs: 7000, elapsedMs: 14_000 }],
    crossings, record: null, bests: [],
  });
  const markup = String(resultView(result, { drivers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }));
  const p2 = /<article class="place">[\s\S]*?<\/article>/.exec(markup)[0];
  assert.match(p2, /<p class="place-figure"><span class="num">\+1 lap<\/span><\/p>/);
  assert.doesNotMatch(p2, /<dt>Time<\/dt>/);
  assert.match(p2, /<dt>Best lap<\/dt>/);
  // The board's switch: no links, no personal bests.
  assert.doesNotMatch(String(resultView(result, { drivers: [], links: false })), /href=|Lap times/);
});

test('a qualifying: pole by its best lap with Laps and Set on lap; P2 and P3 by the gap with Best lap and Laps', async () => {
  const { cards, rows, facts, head } = await pageOf('qualifying');
  assert.equal(cards.length, 3);
  assert.match(figure(cards[0]), /^7\.160 FL/);
  assert.deepEqual(facts(cards[0]), { Laps: '5', 'Set on lap': '2' });
  assert.equal(figure(cards[1]), '+0.043');
  assert.deepEqual(facts(cards[1]), { 'Best lap': '7.203', Laps: '5' });
  assert.deepEqual(head, ['Driver', 'Gap', 'Best lap', 'Laps']);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /<td class="pos">4<\/td>[\s\S]*<td class="num gap">\+0\.146<\/td>/);
});

test('a practice that beat the record: one card from inside says it, the table from 2, then the personal bests', async () => {
  const { cards, rows, facts, head, body } = await pageOf('record');
  const [lead, ...bests] = cards;
  assert.match(lead, /^<article class="place is-first is-record">/, 'the record\'s shadow');
  assert.match(figure(lead), /^7\.070 TR/);
  assert.deepEqual(facts(lead), { Laps: '9', 'Set on lap': '1', 'New track record': 'Beat 7.104 Ana' });
  assert.deepEqual(head, ['Driver', 'Gap', 'Best lap', 'Laps']);
  assert.equal(rows.length, 5, 'from 2');
  assert.match(rows[0], /<td class="pos">2<\/td>/);
  // The personal bests set here; Ana's is the card above, which says what it beat.
  assert.ok(bests.every((c) => /^<article class="place is-pb">/.test(c)));
  assert.deepEqual(bests.map(nameOf), ['Ben Okafor', 'Jo', 'Mia Schulz'], 'Dara drove slower than before; Cyrille, here the first time, beat nothing');
  assert.deepEqual(facts(bests[0]), { Before: '7.250', 'Faster by': '0.096' });
  assert.deepEqual(facts(bests[1]), { Before: '7.444', 'Faster by': '0.041' });
  assert.doesNotMatch(body, /First time on this track/);
  assert.match(figure(bests[0]), /^7\.154 PB/);
  assert.match(body, /<section class="result-pbs" aria-label="Personal bests">/);
});

test('a practice that beat no record says nothing of one, and its facts leave out the fastest lap, its P1 card', async () => {
  const { cards, body } = await pageOf('plain');
  assert.match(cards[0], /^<article class="place is-first">/);
  assert.doesNotMatch(cards[0], /<dt>(?:New track record|Track record)<\/dt>/);
  const facts = [.../<dl class="session-facts">([\s\S]*?)<\/dl>/.exec(body)[1].matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]);
  assert.deepEqual(facts, ['Started', 'Ended', 'Length', 'Track']);
});

test('a practice that set the first record on a track says so on its P1 card, and holds back that driver\'s personal best', () => {
  const lap = { seq: 1, driverId: 'a', lapMs: 7000, counts: true, via: 'net', at: 1 };
  const result = resultOf({
    session: { kind: 'practice' },
    standings: [{ driverId: 'a', position: 1, laps: 1, bestMs: 7000, elapsedMs: null }, { driverId: 'b', position: 2, laps: 1, bestMs: 7500, elapsedMs: null }],
    crossings: [lap, { seq: 2, driverId: 'b', lapMs: 7500, counts: true, via: 'net', at: 2 }],
    record: { driverId: 'a', seq: 1 }, bests: [{ driverId: 'a', seq: 1 }, { driverId: 'b', seq: 2 }],
    fell: { lap: { driverId: 'a', lapMs: 7000, seq: 1 }, beat: null }, before: new Map([['a', 7200], ['b', 7600]]),
  });
  const markup = String(resultView(result, { drivers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }));
  const p1 = /<article class="place is-first">[\s\S]*?<\/article>/.exec(markup)[0];
  assert.match(p1, /<div><dt>Track record<\/dt><dd><span class="fact-word">First on this track<\/span><\/dd><\/div>/);
  assert.doesNotMatch(p1, /New track record/);
  const pbs = [...markup.matchAll(/<article class="place is-pb">[\s\S]*?<\/article>/g)].map((m) => m[0]);
  assert.equal(pbs.length, 1);
  assert.match(pbs[0], /title="B"/);
});

test('the names and Lap times link to lap cards, and the page\'s one action is Back to Sessions', async () => {
  const { body, cards, rows } = await pageOf('race');
  for (const name of ['Ana', 'Dara']) {
    const id = ids[name];
    assert.match(body, new RegExp(`<div class="card-static session-laps" id="driver-${id}">`));
  }
  assert.match(cards[0], new RegExp(`<a class="place-more" href="#driver-${ids.Ana}">Lap times</a>`));
  assert.match(rows[0], new RegExp(`<td class="board-driver"><a href="#driver-${ids.Dara}"><span class="driver"`));
  // The head: breadcrumb, h1 and the facts; Result with All laps at its end; Back to Sessions at the foot.
  const facts = [.../<dl class="session-facts">([\s\S]*?)<\/dl>/.exec(body)[1].matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]);
  assert.deepEqual(facts, ['Started', 'Ended', 'Length', 'Track', 'Fastest lap']);
  assert.match(body, /<div><dt>Length<\/dt><dd>50 s<\/dd><\/div>/, 'a race\'s length is the one it was set to');
  assert.match(body, /<div class="result-head"><h2 id="result-title">Result<\/h2><a href="#laps">All laps<\/a><\/div>/);
  const main = /<main[\s\S]*<\/main>/.exec(body)?.[0] ?? body;
  assert.doesNotMatch(main, /<form|<button/, 'no actions');
  assert.equal(main.match(/class="btn[ "]/g).length, 1);
  assert.match(main, new RegExp(`<p class="session-back"><a class="btn btn-outline" href="/clubs/${ws}/sessions">Back to Sessions</a></p>\\s*</div>`));
});

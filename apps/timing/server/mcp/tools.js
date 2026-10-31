// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The MCP tools (timing MCP spec §5): the member operations of the JSON API,
// written for an assistant. Each one calls the function in operations.js the
// JSON route calls, after the same workspace check, so a rule exists once.
// A tool's `action` is the permission its route asks for; tests hold the two
// together, and hold every API operation to a tool or to the list left out.
import * as z from 'zod/v4';
import { DIRECTIONS } from '@tinylap/track-format';
import { publicSession } from '../engine.js';
import * as ops from '../operations.js';
import { runningFor } from '../sessions-pages.js';

/** API operations deliberately not offered as tools (spec §5.3), as `METHOD path`. */
export const LEFT_OUT = new Set([
  // A tap's lap time is the moment it arrives; an assistant's round trip makes it meaningless.
  'POST /workspaces/{workspace}/tap',
  // Pairing hands the token to the decoder over its cable; over MCP it would only reach the assistant.
  'POST /workspaces/{workspace}/decoders',
  // The live stream; get_live answers the board as it is now.
  'GET /workspaces/{workspace}/live',
]);

const id = (what) => {
  const from = what === 'session' ? 'list_sessions or get_live' : `list_${what}s`;
  return z.string().min(1).max(200).describe(`The ${what}'s id, from ${from}.`);
};
const space = z.string().min(1).max(200).optional()
  .describe('The club or personal space, by id from list_spaces. May be left out when the member has only one.');
const name = (what) => z.string().min(1).max(ops.MAX_NAME).describe(`The ${what}'s name, 1 to ${ops.MAX_NAME} characters.`);
const PALETTE = ops.COLOURS.join(', ');
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe(`A colour as #rrggbb. Left out, the next of ${PALETTE}.`);
const confirmation = z.string().min(1).max(2000).optional()
  .describe('Leave out at first. If the answer asks for confirmation, ask the member, and only if they agree call again with the same arguments and this confirmation.');

const driverOut = z.looseObject({ id: z.string(), name: z.string(), colour: z.string() });
const layoutOut = z.looseObject({ plannerId: z.string(), snapshotKey: z.string(), attachedAt: z.number(), by: z.string().nullable() }).nullable();
const trackOut = z.looseObject({ id: z.string(), name: z.string(), archived: z.boolean(), current: z.boolean(), layout: layoutOut });
const sessionOut = z.looseObject({ id: z.string(), kind: z.string(), state: z.string() });
const deletedOut = z.object({ deleted: z.string() });

/** What a tool that may ask first answers: done, or the question. */
const confirmed = (result) => z.object({
  status: z.enum(['done', 'confirm']).describe('"confirm": nothing changed yet; ask the member, then call again with the confirmation.'),
  result: result.optional(),
  message: z.string().optional(),
  confirmation: z.string().optional(),
});

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const IDEMPOTENT = { ...WRITE, idempotentHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

/** The workspace's own record of a driver, track, decoder or session, or a not-found error. */
const missing = (what) => ops.fail('not-found', `There is no such ${what} here.`);

const KIND_NAMES = { practice: 'practice', qualifying: 'qualifying', race: 'race' };

/**
 * @typedef {{ request: any, claims: any, by: { userId: string, name: string | null } }} ToolContext
 * @typedef {{ value?: any, error?: any }} Outcome
 * A tool's question before it acts: an error, nothing to ask (null), the
 * question with the state it describes, or `done` when asking already acted.
 * @typedef {{ error: any } | { message: string, state: unknown } | { done: Outcome } | null} Asked
 * @typedef {{
 *   name: string, title: string, description: string,
 *   action: import('@tinylap/auth').Action | null,
 *   route: string | null,
 *   annotations: Record<string, boolean>,
 *   input: z.ZodObject<any>,
 *   output: z.ZodType,
 *   run: (ctx: ToolContext, args: any, confirmed: { state: unknown } | null) => Outcome | Promise<Outcome>,
 *   ask?: (ctx: ToolContext, args: any) => Asked | Promise<Asked>,
 * }} Tool
 */

/** @type {Tool[]} */
export const TOOLS = [
  {
    name: 'list_spaces',
    title: 'List your clubs',
    description: 'The clubs and personal spaces the member is in, with their role in each (owner, admin or member). Every other tool takes one of these ids as `space`.',
    action: null,
    route: null,
    annotations: READ,
    input: z.object({}),
    output: z.object({ spaces: z.array(z.looseObject({ id: z.string(), name: z.string().optional(), kind: z.string().optional(), role: z.string() })) }),
    run: ({ claims }) => ({ value: { spaces: (claims.workspaces ?? []).map(({ id: wid, name: n, kind, role }) => ({ id: wid, name: n, kind, role })) } }),
  },
  {
    name: 'get_live',
    title: 'Read the board',
    description: 'The board as it is now: the current track and direction, the running session, standings, recent crossings, drivers, personal bests and the track record. Call again to see it change.',
    action: 'timing.run',
    route: 'GET /workspaces/{workspace}',
    annotations: READ,
    input: z.object({ space }),
    output: z.looseObject({ track: z.looseObject({ id: z.string(), name: z.string() }), direction: z.string(), session: sessionOut.nullable(), standings: z.array(z.any()), crossings: z.array(z.any()), drivers: z.array(driverOut) }),
    run: ({ request }) => ({ value: request.engine.snapshot(request.workspaceId) }),
  },
  {
    name: 'list_drivers',
    title: 'List drivers',
    description: 'The drivers, each with an id, name and colour.',
    action: 'timing.run',
    route: 'GET /workspaces/{workspace}/drivers',
    annotations: READ,
    input: z.object({ space }),
    output: z.object({ drivers: z.array(driverOut) }),
    run: ({ request }) => ({ value: { drivers: request.store.drivers(request.workspaceId) } }),
  },
  {
    name: 'add_driver',
    title: 'Add a driver',
    description: 'Adds a driver. Give a transponder to them with assign_transponder.',
    action: 'timing.setup',
    route: 'POST /workspaces/{workspace}/drivers',
    annotations: WRITE,
    input: z.object({ space, name: name('driver'), colour: colour.optional() }),
    output: driverOut,
    run: ({ request }, args) => ops.addDriver(request, { name: args.name, colour: args.colour }),
  },
  {
    name: 'update_driver',
    title: 'Rename or recolour a driver',
    description: 'Changes a driver\'s name, colour or both.',
    action: 'timing.setup',
    route: 'PATCH /workspaces/{workspace}/drivers/{driver}',
    annotations: IDEMPOTENT,
    input: z.object({ space, driver: id('driver'), name: name('driver').optional(), colour: colour.optional() }),
    output: driverOut,
    run: ({ request }, args) => {
      if (args.name === undefined && args.colour === undefined) return ops.fail('invalid-request', 'Give a new name, a colour, or both.');
      return ops.renameDriver(request, { id: args.driver, name: args.name, colour: args.colour });
    },
  },
  {
    name: 'delete_driver',
    title: 'Delete a driver',
    description: 'Deletes a driver. Their laps stay, as "Former driver"; their transponders become unassigned. Asks for confirmation first.',
    action: 'timing.delete',
    route: 'DELETE /workspaces/{workspace}/drivers/{driver}',
    annotations: DESTRUCTIVE,
    input: z.object({ space, driver: id('driver'), confirmation }),
    output: confirmed(deletedOut),
    ask: ({ request }, args) => {
      const driver = request.store.driver(request.workspaceId, args.driver);
      if (!driver) return missing('driver');
      return { message: `Delete ${driver.name}? Their laps stay on the board as "Former driver", and their transponders become unassigned.`, state: driver.id };
    },
    run: ({ request }, args) => {
      const r = ops.deleteDriver(request, { id: args.driver });
      return r.error ? r : { value: { deleted: args.driver } };
    },
  },
  {
    name: 'list_transponders',
    title: 'List transponders',
    description: 'Every transponder seen or assigned here, with the driver it belongs to, if any.',
    action: 'timing.run',
    route: 'GET /workspaces/{workspace}/transponders',
    annotations: READ,
    input: z.object({ space }),
    output: z.object({ transponders: z.array(z.looseObject({ code: z.string() })) }),
    run: ({ request }) => ({ value: { transponders: request.store.transponders(request.workspaceId) } }),
  },
  {
    name: 'assign_transponder',
    title: 'Assign a transponder',
    description: 'Gives a transponder to a driver, or takes it away with driver: null. The driver gets the transponder\'s laps that had no driver yet.',
    action: 'timing.setup',
    route: 'PUT /workspaces/{workspace}/transponders/{code}',
    annotations: IDEMPOTENT,
    input: z.object({
      space,
      code: z.string().min(1).max(16).describe('The transponder code: 1 to 16 hex digits, as list_transponders or the board shows it.'),
      driver: z.string().min(1).max(200).nullable().describe('The driver\'s id from list_drivers, or null to unassign.'),
    }),
    output: z.object({ code: z.string(), driverId: z.string().nullable() }),
    run: ({ request }, args) => ops.assignTransponder(request, { code: args.code, driverId: args.driver }),
  },
  {
    name: 'list_tracks',
    title: 'List tracks',
    description: 'The tracks, active ones first, each with its newest planner layout or none. One is current: new sessions use it.',
    action: 'timing.run',
    route: 'GET /workspaces/{workspace}/tracks',
    annotations: READ,
    input: z.object({ space, include_archived: z.boolean().optional().describe('Also list the archived tracks.') }),
    output: z.object({ tracks: z.array(trackOut) }),
    run: ({ request }, args) => ({ value: { tracks: ops.listTracks(request, { archived: args.include_archived === true }).value } }),
  },
  {
    name: 'add_track',
    title: 'Add a track',
    description: 'Adds a track; it does not become current (use set_current_track). Its name must be unique among the active tracks. A planner share link adds its first layout.',
    action: 'timing.setup',
    route: 'POST /workspaces/{workspace}/tracks',
    annotations: { ...WRITE, openWorldHint: true },
    input: z.object({ space, name: name('track'), link: z.string().min(1).max(2000).optional().describe('A share link from the planner, for the track\'s layout.') }),
    output: trackOut,
    run: ({ request, by }, args) => ops.addTrack(request, { name: args.name, link: args.link, by }),
  },
  {
    name: 'rename_track',
    title: 'Rename a track',
    description: 'Renames a track. Its records stay.',
    action: 'timing.setup',
    route: 'PATCH /workspaces/{workspace}/tracks/{track}',
    annotations: IDEMPOTENT,
    input: z.object({ space, track: id('track'), name: name('track') }),
    output: trackOut,
    run: ({ request }, args) => ops.renameTrack(request, { id: args.track, name: args.name }),
  },
  {
    name: 'attach_layout',
    title: 'Attach a layout',
    description: 'Attaches a layout from a planner share link to a track. Its records stay. Replacing a layout of a different planner track asks for confirmation first.',
    action: 'timing.setup',
    route: 'POST /workspaces/{workspace}/tracks/{track}/layouts',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    input: z.object({ space, track: id('track'), link: z.string().min(1).max(2000).describe('A share link from the planner.'), confirmation }),
    output: confirmed(z.object({ track: trackOut, result: z.string() })),
    // Whether it replaces another layout is known only once the planner answered: try without confirming.
    ask: async ({ request, by }, args) => {
      const r = await ops.attachLayout(request, { id: args.track, link: args.link, confirm: false, by });
      if (r.error?.problem === 'conflict' && r.error.current) {
        const named = request.store.track(request.workspaceId, args.track)?.name ?? 'This track';
        return { message: `${named} has a layout of another planner track. Replace it? The track's records stay.`, state: r.error.current.snapshotKey };
      }
      return { done: r };
    },
    run: async ({ request, by }, args, confirmedState) => {
      const track = request.store.track(request.workspaceId, args.track);
      if (!track) return missing('track');
      // Replace only the layout the member was shown.
      const confirm = confirmedState !== null && track.layout?.snapshotKey === confirmedState.state;
      return ops.attachLayout(request, { id: args.track, link: args.link, confirm, by });
    },
  },
  {
    name: 'set_current_track',
    title: 'Make a track current',
    description: 'Makes a track current, and sets the direction raced. New sessions use it. If a practice is running and this changes the track or direction, it ends the practice, and asks for confirmation first.',
    action: 'timing.setup',
    route: 'PUT /workspaces/{workspace}/track',
    annotations: DESTRUCTIVE,
    input: z.object({ space, track: id('track'), direction: z.enum(/** @type {[string, ...string[]]} */ ([...DIRECTIONS])).describe('cw (clockwise) or ccw (anticlockwise).'), confirmation }),
    output: confirmed(z.object({ track: trackOut, direction: z.string() })),
    ask: ({ request }, args) => {
      const ws = request.store.workspace(request.workspaceId);
      const running = request.store.runningSession(request.workspaceId);
      if (running?.kind !== 'practice' || (ws.trackId === args.track && ws.direction === args.direction)) return null;
      const track = request.store.track(request.workspaceId, args.track);
      if (!track) return missing('track');
      return { message: `A practice is running. Switching to ${track.name} (${args.direction}) ends it; its laps stay in the history.`, state: running.id };
    },
    run: ({ request }, args) => ops.setCurrentTrack(request, { id: args.track, direction: args.direction }),
  },
  {
    name: 'archive_track',
    title: 'Archive a track',
    description: 'Hides a track from the list; its records stay and it can be restored. The current track can\'t be archived.',
    action: 'timing.setup',
    route: 'PATCH /workspaces/{workspace}/tracks/{track}',
    annotations: IDEMPOTENT,
    input: z.object({ space, track: id('track') }),
    output: trackOut,
    run: ({ request }, args) => ops.archiveTrack(request, { id: args.track }),
  },
  {
    name: 'restore_track',
    title: 'Restore a track',
    description: 'Brings an archived track back, if no active track has its name.',
    action: 'timing.setup',
    route: 'PATCH /workspaces/{workspace}/tracks/{track}',
    annotations: IDEMPOTENT,
    input: z.object({ space, track: id('track') }),
    output: trackOut,
    run: ({ request }, args) => ops.restoreTrack(request, { id: args.track }),
  },
  {
    name: 'delete_track',
    title: 'Delete a track',
    description: 'Deletes an archived track with its layouts and records; its sessions stay, without a track. Archive it first. Asks for confirmation first.',
    action: 'timing.delete',
    route: 'DELETE /workspaces/{workspace}/tracks/{track}',
    annotations: DESTRUCTIVE,
    input: z.object({ space, track: id('track'), confirmation }),
    output: confirmed(deletedOut),
    ask: ({ request }, args) => {
      const ws = request.workspaceId;
      const track = request.store.track(ws, args.track);
      if (!track) return missing('track');
      if (track.archivedAt === null) return ops.fail('conflict', `Archive ${track.name} before deleting it.`);
      if (request.store.runningSession(ws)?.trackId === track.id) return ops.fail('conflict', `${track.name} is in use by the running session.`);
      const n = request.store.sessionCount(ws, track.id);
      const sessions = n === 0 ? 'It has no sessions.' : n === 1 ? 'Its 1 session stays in the history, without a track.' : `Its ${n} sessions stay in the history, without a track.`;
      return { message: `Delete ${track.name}? Its records and layouts are removed. ${sessions}`, state: track.id };
    },
    run: ({ request }, args) => {
      const r = ops.deleteTrack(request, { id: args.track });
      return r.error ? r : { value: { deleted: args.track } };
    },
  },
  {
    name: 'list_decoders',
    title: 'List decoders',
    description: 'The paired decoders, with when each was last heard from. Pairing a new one happens on the bridge page, over the decoder\'s cable.',
    action: 'timing.run',
    route: 'GET /workspaces/{workspace}/decoders',
    annotations: READ,
    input: z.object({ space }),
    output: z.object({ decoders: z.array(z.looseObject({ id: z.string(), name: z.string() })) }),
    run: ({ request }) => ({ value: { decoders: request.store.decoders(request.workspaceId) } }),
  },
  {
    name: 'unpair_decoder',
    title: 'Unpair a decoder',
    description: 'Unpairs a decoder: its token stops working at once, its passings stay. Asks for confirmation first.',
    action: 'timing.delete',
    route: 'DELETE /workspaces/{workspace}/decoders/{decoder}',
    annotations: DESTRUCTIVE,
    input: z.object({ space, decoder: id('decoder'), confirmation }),
    output: confirmed(deletedOut),
    ask: ({ request }, args) => {
      const decoder = request.store.decoders(request.workspaceId).find((d) => d.id === args.decoder);
      if (!decoder) return missing('decoder');
      return { message: `Unpair ${decoder.name}? Its token stops working at once. Its passings stay.`, state: decoder.id };
    },
    run: ({ request }, args) => {
      const r = ops.unpairDecoder(request, { id: args.decoder });
      return r.error ? r : { value: { deleted: args.decoder } };
    },
  },
  {
    name: 'list_sessions',
    title: 'List sessions',
    description: 'Recent practices, qualifyings and races, newest first.',
    action: 'timing.run',
    route: 'GET /workspaces/{workspace}/sessions',
    annotations: READ,
    input: z.object({ space, limit: z.number().int().min(1).max(50).optional().describe('How many, 1 to 50; 20 when left out.') }),
    output: z.object({ sessions: z.array(sessionOut) }),
    run: ({ request }, args) => ({ value: { sessions: request.store.listSessions(request.workspaceId, args.limit ?? 20).map(publicSession) } }),
  },
  {
    name: 'get_session',
    title: 'Read a session\'s results',
    description: 'A session with its standings. Its crossings (every lap) only with include_crossings, newest first.',
    action: 'timing.run',
    route: 'GET /workspaces/{workspace}/sessions/{session}',
    annotations: READ,
    input: z.object({
      space,
      session: id('session'),
      include_crossings: z.boolean().optional().describe('Also return the crossings, newest first.'),
      crossings_limit: z.number().int().min(1).max(200).optional().describe('How many crossings, 1 to 200; 50 when left out.'),
    }),
    output: z.looseObject({ session: sessionOut, standings: z.array(z.any()), crossings: z.array(z.any()).optional(), crossingsTotal: z.number() }),
    run: ({ request }, args) => {
      const detail = request.engine.sessionDetail(request.workspaceId, args.session);
      if (!detail) return missing('session');
      const { crossings, ...rest } = detail;
      const newest = args.include_crossings ? crossings.slice(-(args.crossings_limit ?? 50)).reverse() : undefined;
      return { value: { ...rest, crossingsTotal: crossings.length, ...(newest ? { crossings: newest } : {}) } };
    },
  },
  {
    name: 'start_session',
    title: 'Start a session',
    description: 'Starts a practice, a qualifying or a race on the current track. A practice takes no other field. A qualifying or race needs a roster of 1 to 20 driver ids. If a session is running, asks for confirmation first: starting ends it.',
    action: 'timing.run',
    route: 'POST /workspaces/{workspace}/sessions',
    annotations: DESTRUCTIVE,
    input: z.object({
      space,
      kind: z.enum(['practice', 'qualifying', 'race']),
      roster: z.array(z.string().min(1).max(200)).min(1).max(20).optional().describe('Driver ids from list_drivers, for a qualifying or race.'),
      duration_seconds: z.number().int().min(10).max(3600).optional().describe('For a qualifying or race: 10 to 3600 seconds; 300 when left out.'),
      countdown_seconds: z.number().int().min(0).max(30).optional().describe('For a race: the start countdown, 0 to 30 seconds; 10 when left out.'),
      confirmation,
    }),
    output: confirmed(sessionOut),
    ask: ({ request }, args) => {
      const errors = ops.startErrors(request, { kind: args.kind, roster: args.roster, durationSeconds: args.duration_seconds, countdownSeconds: args.countdown_seconds });
      if (errors.length) return { error: errors[0] };
      const running = request.store.runningSession(request.workspaceId);
      if (!running) return null;
      const minutes = Math.floor(Math.max(0, request.now() - (running.opensAt ?? running.createdAt)) / 60_000);
      const what = KIND_NAMES[args.kind];
      const now = runningFor(running.kind, minutes, request.engine.driverCount(running), running.state === 'countdown');
      return { message: `${now} Starting this ${what} ends it.`, state: running.id };
    },
    run: ({ request }, args, confirmedState) => {
      // Replace only the session the member was shown; anything else running asks again.
      const running = request.store.runningSession(request.workspaceId);
      const replace = confirmedState !== null && running?.id === confirmedState.state;
      return ops.startSession(request, { kind: args.kind, roster: args.roster, durationSeconds: args.duration_seconds, countdownSeconds: args.countdown_seconds, replace });
    },
  },
  {
    name: 'end_session',
    title: 'End a practice',
    description: 'Ends a running practice at its last lap; its laps stay in the history. Asks for confirmation first.',
    action: 'timing.run',
    route: 'POST /workspaces/{workspace}/sessions/{session}/end',
    annotations: DESTRUCTIVE,
    input: z.object({ space, session: id('session'), confirmation }),
    output: confirmed(sessionOut),
    ask: ({ request }, args) => {
      const running = request.store.runningSession(request.workspaceId);
      if (running?.id !== args.session || running.kind !== 'practice') return missing('running practice');
      return { message: 'End the practice? The practice ends at its last lap. Its laps stay in the history.', state: running.id };
    },
    run: ({ request }, args) => ops.endSession(request, { id: args.session }),
  },
  {
    name: 'abort_session',
    title: 'Abort a qualifying or race',
    description: 'Aborts a running qualifying or race: it ends now, and its laps stay in the history. Asks for confirmation first.',
    action: 'timing.run',
    route: 'POST /workspaces/{workspace}/sessions/{session}/abort',
    annotations: DESTRUCTIVE,
    input: z.object({ space, session: id('session'), confirmation }),
    output: confirmed(sessionOut),
    ask: ({ request }, args) => {
      const running = request.store.runningSession(request.workspaceId);
      if (running?.id !== args.session || running.kind === 'practice') return missing('running qualifying or race');
      const what = running.kind === 'race' ? 'race' : 'qualifying';
      return { message: `Abort the ${what}? The ${what} ends now. Its laps stay in the history.`, state: running.id };
    },
    run: ({ request }, args) => ops.abortSession(request, { id: args.session }),
  },
  {
    name: 'get_watch_link',
    title: 'Get the watchers link',
    description: 'The watchers link: anyone with it can watch the board live, without signing in. Share it only as the member asks. null when there is none yet.',
    action: 'timing.run',
    route: 'GET /workspaces/{workspace}/watch-token',
    annotations: READ,
    input: z.object({ space }),
    output: z.object({ url: z.string().nullable() }),
    run: ({ request }) => {
      const token = request.store.workspace(request.workspaceId).watchToken;
      return { value: { url: token ? `${request.origin}/watch/${token}` : null } };
    },
  },
  {
    name: 'rotate_watch_link',
    title: 'Make a new watchers link',
    description: 'Makes a new watchers link. The old one stops working, and anyone watching with it is cut off, so this asks for confirmation first when a link exists.',
    action: 'timing.setup',
    route: 'POST /workspaces/{workspace}/watch-token',
    annotations: DESTRUCTIVE,
    input: z.object({ space, confirmation }),
    output: confirmed(z.object({ url: z.string() })),
    ask: ({ request }) => {
      const token = request.store.workspace(request.workspaceId).watchToken;
      if (!token) return null;
      return { message: 'Make a new watchers link? The old link stops working, and anyone watching with it is cut off.', state: ops.tokenHash(token) };
    },
    run: ({ request }) => {
      const { token } = ops.rotateWatchLink(request).value;
      return { value: { url: `${request.origin}/watch/${token}` } };
    },
  },
];

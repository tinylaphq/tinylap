// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

/** One car crossing the line, as a decoder reports it (spec §4). */
export interface Passing {
  decoder: string;
  boot: string;
  transponder: string;
  /** Milliseconds on the decoder's clock since `boot`. */
  t: number;
}

/** An ingest batch: one boot of one decoder (spec §5). */
export interface Batch {
  boot: string;
  passings: { transponder: string; t: number }[];
}

/** The decoder-time position of a passing, for lap arithmetic. */
export interface Mark {
  boot: string;
  t: number;
}

/** What one passing means for its transponder (laps.js). */
export type LapStep =
  | { kind: 'start'; reference: Mark }
  | { kind: 'lap'; ms: number; reference: Mark }
  | { kind: 'double'; reference: Mark }
  | { kind: 'backwards'; reference: Mark };

export type SessionKind = 'practice' | 'qualifying' | 'race';

/** What sessions.js needs to know about a session. Times are server epoch ms. */
export interface SessionRules {
  kind: SessionKind;
  /** Driver ids, or null for practice (anyone). */
  roster: string[] | null;
  /** Qualifying: the window opens. Race: "go". Practice: unused. */
  opensAt: number | null;
  /** Qualifying: the window closes. Race: time is up. Practice: null. */
  closesAt: number | null;
}

/** A passing as a session sees it. */
export interface Crossing {
  driverId: string | null;
  /** Server time of the passing (decoder time mapped, spec §6). */
  at: number;
  /** The lap this passing completes, or null (start, double read, parked car). */
  lapMs: number | null;
}

export interface DriverState {
  started: boolean;
  startAt: number | null;
  laps: number;
  totalMs: number;
  bestMs: number | null;
  bestAt: number | null;
  lastAt: number | null;
  finished: boolean;
}

export interface SessionState {
  drivers: Record<string, DriverState>;
}

export interface Standing {
  driverId: string;
  position: number;
  laps: number;
  bestMs: number | null;
  bestAt: number | null;
  /** Server time of the driver's last crossing in this session, counted or not. */
  lastAt: number | null;
  totalMs: number;
  /** Race only: reaction after "go" plus the laps. */
  elapsedMs: number | null;
  finished: boolean;
}

export type ZroundMessage =
  | { type: 'startup' }
  | { type: 'ack' }
  | { type: 'reset' }
  | { type: 'stop' }
  | { type: 'clock'; t: number }
  | { type: 'lap'; transponder: string; t: number }
  | { type: 'hello-request' }
  | { type: 'hello'; decoder: string | null; boot: string }
  | { type: 'pair'; decoder: string; token: string }
  | { type: 'wifi'; ssid: string; password: string }
  | { type: 'ok' }
  | { type: 'error'; text: string }
  | { type: 'unknown'; raw: string };

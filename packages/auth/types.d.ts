// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: MPL-2.0

export type Role = 'owner' | 'admin' | 'member';
export type Action =
  | 'track.read'
  | 'track.save'
  | 'track.share'
  | 'track.copy'
  | 'track.delete'
  | 'invite.manage'
  | 'member.remove'
  | 'admin.manage'
  | 'owner.transfer'
  | 'club.manage'
  | 'club.leave'
  | 'timing.run'
  | 'timing.setup'
  | 'timing.delete';

export interface WorkspaceClaim {
  id: string;
  role: Role;
  /** The workspace's display name, as accounts issues it. */
  name?: string;
  /** A person's own space or a club. Tokens from before 2026-10-15 lack it. */
  kind?: 'personal' | 'club';
}

export interface AccessClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  workspaces: WorkspaceClaim[];
}

export function verifyAccessToken(
  token: string,
  options: {
    issuer: string;
    audience: string;
    jwks?: import('jose').JWTVerifyGetKey;
    clockTolerance?: number;
  }
): Promise<AccessClaims>;

/** Takes verified claims, or any `{ workspaces }` (accounts passes live memberships). */
export function can(claims: Pick<AccessClaims, 'workspaces'>, workspaceId: string, action: Action): boolean;

export const ROLES: readonly Role[];
export const ACTIONS: readonly Action[];

export class AuthError extends Error {
  constructor(code: 'invalid_token' | 'unavailable', message: string, options?: ErrorOptions);
  code: 'invalid_token' | 'unavailable';
}

export function clientBucket(address: string): string;

export interface RateLimiter {
  /** 0 when allowed, else seconds until it is again. */
  take(client: string): number;
  readonly size: number;
  stop(): void;
}

export function rateLimiter(options: {
  limit: number;
  windowMs?: number;
  now?: () => number;
  sweepMs?: number;
}): RateLimiter;

export interface SealKey {
  id: string;
  /** 32 bytes for AES-256-GCM. */
  key: Buffer;
}

/** Parses `TINYLAP_TOKEN_KEYS`: `<id>:<base64 32 bytes>,<id>:<…>`, newest first. */
export function parseKeys(text: string | undefined): SealKey[];
/** AES-256-GCM with the first key: `<kid>.<iv>.<ciphertext+tag>`, base64url. `purpose` is authenticated (AAD). */
export function seal(keys: SealKey[], plaintext: string, purpose?: string): string;
/** Opens with whichever listed key the id names; throws for an unknown id, another purpose, or tampering. */
export function open(keys: SealKey[], sealed: string, purpose?: string): string;

export interface StoredSession {
  userId: string;
  sealedTokens: string;
  /** ms since the epoch, at login. */
  createdAt: number;
  /** ms since the epoch: 30 days after the last refresh, at most 90 after login. */
  expiresAt: number;
}

export interface SessionStore {
  /** `id` is the SHA-256 (hex) of the cookie value. */
  get(id: string): Promise<StoredSession | null>;
  set(id: string, session: StoredSession): Promise<void>;
  delete(id: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

/** What `sealedTokens` holds. */
export interface SealedTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  /** The access token's `exp`, in ms. */
  expiresAt: number;
}

export interface BffOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Absolute; its origin is the app origin. */
  redirectUri: string;
  postLogoutRedirectUri: string;
  /** RFC 8707 resource: the audience of the access tokens. */
  resource: string;
  store: SessionStore;
  /** Newest first: the first seals, any opens. */
  keys: SealKey[];
  scope?: string;
  cookieName?: string;
  /** Default true. False drops `Secure` and the `__Host-` prefix. */
  secureCookies?: boolean;
  /** Per call to the issuer (discovery, token, revocation). Default 15000. */
  fetchTimeoutMs?: number;
  /** The fetch used for calls to the issuer; for tests and instrumentation. */
  fetch?: typeof globalThis.fetch;
  /** Where skipped failures (revocation, a failed or unusable refresh, an issuer's 429) are reported. Default `console`. No tokens or user data in the messages. */
  logger?: { warn(message: string): void };
}

/** Enough of a node:http IncomingMessage. */
export interface BffRequest {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface BffResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body?: string;
}

export interface BffSession {
  userId: string;
  accessToken: string;
  claims: AccessClaims;
}

export interface Bff {
  /** 302 to the issuer; `?returnTo=` must be a same-origin path, else `/`. */
  login(req: BffRequest): Promise<BffResponse>;
  /** 302 to `returnTo` with the session cookie, or 400 when the log-in can't complete. */
  callback(req: BffRequest): Promise<BffResponse>;
  /** Forgets the session, revokes its refresh token (best effort, 3 s), 302 to the issuer's end_session_endpoint, or to postLogoutRedirectUri when the issuer can't be reached or has none. Always clears the cookie; never throws for an outage. */
  logout(req: BffRequest): Promise<BffResponse>;
  /** The session, refreshed when under 60 s are left (one refresh in flight per session); null when logged out. */
  session(req: BffRequest): Promise<BffSession | null>;
  /** The store id (SHA-256 hex) of the request's session cookie, or null; it doesn't check that the session exists. For apps that keep data next to a session. */
  sessionId(req: BffRequest): string | null;
  /** `Sec-Fetch-Site: same-origin`, or else an `Origin` equal to the app origin. */
  requireSameOrigin(req: BffRequest): boolean;
}

/** `login`, `callback` and `session` throw `AuthError('unavailable')` when the issuer is down, slow, failing or rate-limiting (429); `logout` never does. */
export function createBff(options: BffOptions): Bff;

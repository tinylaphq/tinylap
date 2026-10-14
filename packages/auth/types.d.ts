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
  | 'club.leave';

export interface WorkspaceClaim {
  id: string;
  role: Role;
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
    jwks?: any;
    clockTolerance?: number;
  }
): Promise<AccessClaims>;

export function can(claims: AccessClaims, workspaceId: string, action: Action): boolean;

export const ROLES: readonly Role[];
export const ACTIONS: readonly Action[];

export class AuthError extends Error {
  code: string;
}

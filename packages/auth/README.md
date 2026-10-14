# @tinylap/auth

Access token verification and permission checks for apps and MCP servers in the TinyLap suite.

## `verifyAccessToken(token, options)`

Verifies an OAuth 2.0 access token against the issuer's published JWKS. Always uses RS256; throws `AuthError` with `code: 'invalid_token'` if the token is missing, malformed, signed with a different algorithm, expired, issued by the wrong issuer, or not meant for this audience.

```js
import { verifyAccessToken } from '@tinylap/auth';

const claims = await verifyAccessToken(token, {
  issuer: 'https://accounts.tinylap.club',
  audience: 'https://planner.tinylap.club',
  // jwks: optional, defaults to a cached JWKS set fetched from issuer/jwks
  // clockTolerance: optional, defaults to 5 seconds
});

console.log(claims.sub); // user ID
console.log(claims.workspaces); // [{ id, role }]
```

## `can(claims, workspaceId, action)`

Checks whether the user identified by `claims` has permission to perform `action` in `workspaceId`. Returns `false` if the user is not a member of the workspace, if the action is unknown, or if their role does not allow the action.

```js
import { can } from '@tinylap/auth';

if (can(claims, workspaceId, 'track.save')) {
  // User may read, save, share, and copy tracks
}
if (can(claims, workspaceId, 'admin.manage')) {
  // User is an owner; they can change admin membership
}
```

## Permission matrix

| Action | owner | admin | member |
| --- | --- | --- | --- |
| `track.read` | ✓ | ✓ | ✓ |
| `track.save` | ✓ | ✓ | ✓ |
| `track.share` | ✓ | ✓ | ✓ |
| `track.copy` | ✓ | ✓ | ✓ |
| `track.delete` | ✓ | ✓ | |
| `invite.manage` | ✓ | ✓ | |
| `member.remove` | ✓ | ✓ | |
| `admin.manage` | ✓ | | |
| `owner.transfer` | ✓ | | |
| `club.manage` | ✓ | | |
| `club.leave` | | ✓ | ✓ |

## Provider independence

This package never depends on a specific identity provider. `verifyAccessToken` accepts any OAuth 2.0 access token issued by any provider, provided the issuer publishes an RS256 JWKS at `{issuer}/jwks`. Task 2 uses OpenID Connect discovery to use the actual `jwks_uri` if it differs.

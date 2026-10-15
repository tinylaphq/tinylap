// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Against a running image: discovery, the signing keys, the sign-in page and
// the protected deletions feed. Self-contained, so CI can run it without
// installing anything.
const base = new URL(process.argv[2] ?? 'http://localhost:4100/');
const failures = [];
const expect = (ok, msg) => { if (!ok) failures.push(msg); };

const discovery = await fetch(new URL('.well-known/openid-configuration', base));
expect(discovery.status === 200, `GET discovery -> ${discovery.status}`);
const meta = await discovery.json();
expect(typeof meta.issuer === 'string' && meta.issuer !== '', 'discovery has an issuer');
expect(typeof meta.jwks_uri === 'string' && meta.jwks_uri !== '', 'discovery has a jwks_uri');
expect(meta.id_token_signing_alg_values_supported?.includes('RS256'), `RS256 in ${JSON.stringify(meta.id_token_signing_alg_values_supported)}`);

// The JWKS is read through the running server, not the (possibly public) URL
// the issuer advertises.
const jwks = await fetch(new URL(new URL(meta.jwks_uri).pathname, base));
expect(jwks.status === 200, `GET jwks -> ${jwks.status}`);
const { keys = [] } = await jwks.json();
expect(keys.length > 0 && keys.every((k) => k.kty === 'RSA' && k.kid), `jwks keys ${JSON.stringify(keys.map((k) => k.kty))}`);

const signIn = await fetch(new URL('sign-in', base));
expect(signIn.status === 200, `GET /sign-in -> ${signIn.status}`);
expect(/^text\/html/.test(signIn.headers.get('content-type') ?? ''), `sign-in content-type ${signIn.headers.get('content-type')}`);
expect(Boolean(signIn.headers.get('content-security-policy')), 'sign-in has a Content-Security-Policy');
await signIn.arrayBuffer();

const feed = await fetch(new URL('deletions', base));
expect(feed.status === 401, `GET /deletions without a token -> ${feed.status}`);
await feed.arrayBuffer();

console.log(`accounts smoke: issuer ${meta.issuer}, ${keys.length} key(s)`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

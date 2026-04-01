/**
 * Mock OIDC server for testing OAuth sign-in flows.
 *
 * Implements enough of the OpenID Connect spec for NextAuth's Google provider to work:
 * - Discovery document (/.well-known/openid-configuration)
 * - JWKS endpoint (/.well-known/jwks.json)
 * - Authorization endpoint (/auth) — auto-approves and redirects back with a code
 * - Token endpoint (/token) — exchanges code for access_token + signed id_token
 * - Userinfo endpoint (/userinfo) — returns the current mock profile
 * - Configure endpoint (/configure) — lets tests set the profile for the next flow
 * - Set-error endpoint (/set-error) — makes the next /auth redirect return an error
 *
 * The server is provider-agnostic: any OAuth 2.0 / OIDC provider that accepts a
 * configurable wellKnown/discovery URL can point at this server in tests.
 */

import http from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';

export interface MockOAuthProfile {
  sub: string;
  name: string;
  email: string;
  picture?: string;
  email_verified?: boolean;
}

export interface MockOAuthServer {
  port: number;
  close: () => Promise<void>;
}

// Generate a fresh RSA-2048 keypair every time the server starts.
// The public key is exposed as JWKS; the private key signs id_tokens.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const publicKeyJwk = crypto.createPublicKey(publicKey).export({ format: 'jwk' }) as Record<string, unknown>;
const KEY_ID = 'mock-key-1';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => resolve(data));
  });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

export async function startMockOAuthServer(): Promise<MockOAuthServer> {
  // Shared mutable state — tests are expected to run serially within googleSignIn.spec.ts
  let currentProfile: MockOAuthProfile = {
    sub: `mock-${crypto.randomUUID()}`,
    name: 'Mock User',
    email: 'mock@example.com',
    email_verified: true,
  };
  let nextError: string | null = null;

  // Maps issued auth codes and access tokens to profiles
  const codeProfiles = new Map<string, MockOAuthProfile>();
  const tokenProfiles = new Map<string, MockOAuthProfile>();

  const server = http.createServer(async (req, res) => {
    const port = (server.address() as AddressInfo).port;
    const base = `http://localhost:${port}`;
    const url = new URL(req.url ?? '/', base);

    // ── OIDC Discovery ────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/auth`,
        token_endpoint: `${base}/token`,
        userinfo_endpoint: `${base}/userinfo`,
        jwks_uri: `${base}/.well-known/jwks.json`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: ['openid', 'email', 'profile'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        code_challenge_methods_supported: ['S256', 'plain'],
      });
    }

    // ── JWKS ─────────────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
      return json(res, 200, {
        keys: [{ ...publicKeyJwk, use: 'sig', alg: 'RS256', kid: KEY_ID }],
      });
    }

    // ── Authorization (auto-consent) ──────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/auth') {
      const redirectUri = url.searchParams.get('redirect_uri')!;
      const state = url.searchParams.get('state') ?? '';
      const callbackUrl = new URL(redirectUri);

      if (nextError) {
        callbackUrl.searchParams.set('error', nextError);
        callbackUrl.searchParams.set('state', state);
        nextError = null;
        res.writeHead(302, { Location: callbackUrl.toString() });
        return res.end();
      }

      const code = crypto.randomUUID();
      codeProfiles.set(code, { ...currentProfile });
      callbackUrl.searchParams.set('code', code);
      callbackUrl.searchParams.set('state', state);
      res.writeHead(302, { Location: callbackUrl.toString() });
      return res.end();
    }

    // ── Token exchange ────────────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/token') {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const code = params.get('code') ?? '';
      const profile = codeProfiles.get(code) ?? currentProfile;
      codeProfiles.delete(code);

      const accessToken = crypto.randomUUID();
      tokenProfiles.set(accessToken, profile);

      const clientId = params.get('client_id') ?? process.env.GOOGLE_CLIENT_ID ?? 'mock-client-id';
      const idToken = jwt.sign(
        {
          iss: base,
          sub: profile.sub,
          aud: clientId,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          name: profile.name,
          email: profile.email,
          email_verified: profile.email_verified ?? true,
          ...(profile.picture ? { picture: profile.picture } : {}),
        },
        privateKey,
        { algorithm: 'RS256', keyid: KEY_ID },
      );

      return json(res, 200, {
        access_token: accessToken,
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }

    // ── Userinfo ──────────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/userinfo') {
      const auth = req.headers.authorization?.replace('Bearer ', '') ?? '';
      const profile = tokenProfiles.get(auth) ?? currentProfile;
      return json(res, 200, profile);
    }

    // ── Test helpers ──────────────────────────────────────────────────────────

    // POST /configure  { sub, name, email, picture? }
    if (req.method === 'POST' && url.pathname === '/configure') {
      const body = await readBody(req);
      currentProfile = { email_verified: true, ...JSON.parse(body) };
      res.writeHead(200);
      return res.end();
    }

    // POST /set-error  { error: 'access_denied' }
    if (req.method === 'POST' && url.pathname === '/set-error') {
      const body = await readBody(req);
      nextError = JSON.parse(body).error as string;
      res.writeHead(200);
      return res.end();
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () => new Promise((r, e) => server.close((err) => (err ? e(err) : r()))),
      });
    });
    server.on('error', reject);
  });
}

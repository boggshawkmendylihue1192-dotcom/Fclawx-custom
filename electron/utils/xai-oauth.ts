import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { proxyAwareFetch } from './proxy-fetch';

const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const ISSUER = 'https://auth.x.ai';
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const REDIRECT_URI = 'http://127.0.0.1:56121/callback';
const CALLBACK_HOST = '127.0.0.1';
const CALLBACK_PORT = 56121;
const CALLBACK_PATH = '/callback';
const FETCH_TIMEOUT_MS = 30_000;
const CALLBACK_TIMEOUT_MS = 300_000;

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>xAI authentication successful</title>
</head>
<body>
  <p>xAI authentication successful. Return to ClawX to continue.</p>
</body>
</html>`;

export interface XAiOAuthCredentials {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
  email?: string;
  displayName?: string;
  idToken?: string;
  tokenEndpoint?: string;
}

interface XAiOAuthDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

interface XAiAuthorizationFlow {
  verifier: string;
  challenge: string;
  state: string;
  nonce: string;
  url: string;
}

interface LocalOAuthServer {
  close: () => void;
  waitForCode: () => Promise<{ code: string } | null>;
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('hex');
  const challenge = toBase64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createState(): string {
  return randomBytes(32).toString('hex');
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // not a URL
  }

  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }

  return { code: value };
}

function decodeJwtPayload(token?: string): Record<string, unknown> {
  if (!token) return {};
  const payload = token.split('.')[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isTrustedXAiEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && (url.hostname === 'x.ai' || url.hostname.endsWith('.x.ai'));
  } catch {
    return false;
  }
}

function requireTrustedXAiEndpoint(endpoint: unknown, label: string): string {
  if (typeof endpoint !== 'string' || !isTrustedXAiEndpoint(endpoint)) {
    throw new Error(`xAI OAuth discovery returned untrusted ${label}`);
  }
  return endpoint;
}

async function readJsonResponse(response: Response, context: string): Promise<Record<string, unknown>> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // ignore malformed error bodies
  }

  if (!response.ok) {
    const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const error = record.error_description ?? record.error;
    throw new Error(`${context} failed (${response.status})${typeof error === 'string' ? `: ${error}` : ''}`);
  }

  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

async function fetchDiscovery(): Promise<XAiOAuthDiscovery> {
  const response = await proxyAwareFetch(DISCOVERY_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'OpenClaw/1.0 ClawX',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const json = await readJsonResponse(response, 'xAI OAuth discovery');
  return {
    authorizationEndpoint: requireTrustedXAiEndpoint(json.authorization_endpoint, 'authorization endpoint'),
    tokenEndpoint: requireTrustedXAiEndpoint(json.token_endpoint, 'token endpoint'),
  };
}

async function createAuthorizationFlow(discovery: XAiOAuthDiscovery): Promise<XAiAuthorizationFlow> {
  const { verifier, challenge } = createPkce();
  const state = createState();
  const nonce = randomBytes(16).toString('hex');
  const url = new URL(discovery.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('plan', 'generic');
  url.searchParams.set('referrer', 'openclaw');
  return { verifier, challenge, state, nonce, url: url.toString() };
}

function startLocalOAuthServer(state: string): Promise<LocalOAuthServer | null> {
  let lastCode: string | null = null;

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '', REDIRECT_URI);
      if (url.pathname !== CALLBACK_PATH) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        res.statusCode = 400;
        res.end(`Authentication failed: ${error}`);
        return;
      }

      if (url.searchParams.get('state') !== state) {
        res.statusCode = 400;
        res.end('State mismatch');
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.statusCode = 400;
        res.end('Missing authorization code');
        return;
      }

      lastCode = code;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(SUCCESS_HTML);
    } catch {
      res.statusCode = 500;
      res.end('Internal error');
    }
  });

  return new Promise((resolve) => {
    server
      .listen(CALLBACK_PORT, CALLBACK_HOST, () => {
        resolve({
          close: () => server.close(),
          waitForCode: async () => {
            const sleep = () => new Promise((r) => setTimeout(r, 100));
            for (let elapsed = 0; elapsed < CALLBACK_TIMEOUT_MS; elapsed += 100) {
              if (lastCode) {
                return { code: lastCode };
              }
              await sleep();
            }
            return null;
          },
        });
      })
      .on('error', () => {
        resolve(null);
      });
  });
}

function normalizeExpires(expiresIn: unknown, accessToken: string): number {
  const seconds = typeof expiresIn === 'number'
    ? expiresIn
    : typeof expiresIn === 'string'
      ? Number.parseFloat(expiresIn)
      : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return Date.now() + seconds * 1000;
  }

  const exp = decodeJwtPayload(accessToken).exp;
  if (typeof exp === 'number' && Number.isFinite(exp) && exp > 0) {
    return exp * 1000;
  }

  return Date.now() + 60 * 60 * 1000;
}

async function exchangeAuthorizationCode(
  discovery: XAiOAuthDiscovery,
  code: string,
  verifier: string,
  challenge: string,
): Promise<XAiOAuthCredentials> {
  const response = await proxyAwareFetch(discovery.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'OpenClaw/1.0 ClawX',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const json = await readJsonResponse(response, 'xAI OAuth token exchange');
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : '';
  const idToken = typeof json.id_token === 'string' ? json.id_token : undefined;
  if (!access || !refresh) {
    throw new Error('xAI OAuth token response missing access_token or refresh_token');
  }

  const payload = decodeJwtPayload(idToken || access);
  const accountId = typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : 'default';
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const displayName = typeof payload.name === 'string' ? payload.name : undefined;

  return {
    access,
    refresh,
    expires: normalizeExpires(json.expires_in, access),
    accountId,
    email,
    displayName,
    idToken,
    tokenEndpoint: discovery.tokenEndpoint,
  };
}

export async function loginXAiOAuth(options: {
  openUrl: (url: string) => Promise<void>;
  onProgress?: (message: string) => void;
  onManualCodeRequired?: (payload: { authorizationUrl: string; reason: 'port_in_use' | 'callback_timeout' }) => void;
  onManualCodeInput?: () => Promise<string>;
}): Promise<XAiOAuthCredentials> {
  options.onProgress?.('Starting xAI OAuth discovery...');
  const discovery = await fetchDiscovery();
  const { verifier, challenge, state, url } = await createAuthorizationFlow(discovery);
  const server = await startLocalOAuthServer(state);

  try {
    await options.openUrl(url);
    options.onProgress?.(
      server ? `Waiting for xAI OAuth callback on ${REDIRECT_URI}...` : 'xAI OAuth callback port unavailable, waiting for manual authorization code...',
    );

    let code: string | undefined;
    if (server) {
      const result = await server.waitForCode();
      code = result?.code ?? undefined;
      if (!code && options.onManualCodeInput) {
        options.onManualCodeRequired?.({ authorizationUrl: url, reason: 'callback_timeout' });
        code = await options.onManualCodeInput();
      }
    } else {
      if (!options.onManualCodeInput) {
        throw new Error(`Cannot start xAI OAuth callback server on ${CALLBACK_HOST}:${CALLBACK_PORT}`);
      }
      options.onManualCodeRequired?.({ authorizationUrl: url, reason: 'port_in_use' });
      code = await options.onManualCodeInput();
    }

    if (!code) {
      throw new Error('Missing xAI authorization code');
    }

    const parsed = parseAuthorizationInput(code);
    if (parsed.state && parsed.state !== state) {
      throw new Error('xAI OAuth state mismatch');
    }

    if (!parsed.code) {
      throw new Error('Missing xAI authorization code');
    }

    return await exchangeAuthorizationCode(discovery, parsed.code, verifier, challenge);
  } finally {
    server?.close();
  }
}

import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../logger.js';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTH_URL = 'https://console.anthropic.com/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const SUCCESS_URL = 'https://console.anthropic.com/oauth/code/success?app=claude-code';
const SCOPES = 'org:create_api_key user:profile user:inference';
const FLOW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const CREDENTIALS_DIR = path.join(os.homedir(), '.claude');
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, '.credentials.json');

// Active flow state
let callbackServer: http.Server | null = null;
let flowTimeout: ReturnType<typeof setTimeout> | null = null;
let activeState: string | null = null;
let activeCodeVerifier: string | null = null;

function generateCodeVerifier(): string {
  return crypto.randomBytes(96).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function isFlowActive(): boolean {
  return callbackServer !== null;
}

export function cleanupFlow(): void {
  if (flowTimeout) {
    clearTimeout(flowTimeout);
    flowTimeout = null;
  }
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
  }
  activeState = null;
  activeCodeVerifier = null;
}

function writeCredentials(tokenData: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  account_subscription_type?: string;
  account_rate_limit_tier?: string;
}): void {
  // Read existing credentials file or start fresh
  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      existing = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    }
  } catch {
    // Start fresh if unreadable
  }

  existing.claudeAiOauth = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresAt: tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : null,
    scopes: SCOPES.split(' '),
    subscriptionType: tokenData.account_subscription_type ?? null,
    rateLimitTier: tokenData.account_rate_limit_tier ?? null,
  };

  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(existing, null, 2), 'utf-8');
  logger.info('OAuth credentials written successfully');
}

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  state: string,
): Promise<void> {
  const body = JSON.stringify({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
    state,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const tokenData = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    account_subscription_type?: string;
    account_rate_limit_tier?: string;
  };

  writeCredentials(tokenData);
}

export async function startOAuthFlow(): Promise<void> {
  // Clean up any previous flow
  if (isFlowActive()) {
    cleanupFlow();
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  activeCodeVerifier = codeVerifier;
  activeState = state;

  // Create ephemeral callback server
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname !== '/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const receivedState = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      logger.error({ error }, 'OAuth callback received error');
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Login failed</h1><p>You can close this tab.</p></body></html>');
      cleanupFlow();
      return;
    }

    if (receivedState !== activeState) {
      logger.warn('OAuth callback state mismatch (possible CSRF)');
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Invalid state</h1><p>Please try logging in again.</p></body></html>');
      return;
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Missing authorization code</h1></body></html>');
      return;
    }

    const port = (server.address() as { port: number }).port;
    const redirectUri = `http://localhost:${port}/callback`;

    exchangeCodeForTokens(code, redirectUri, activeCodeVerifier!, activeState!)
      .then(() => {
        res.writeHead(302, { Location: SUCCESS_URL });
        res.end();
        logger.info('OAuth flow completed successfully');
        cleanupFlow();
      })
      .catch((err) => {
        logger.error({ err }, 'Token exchange failed');
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Login failed</h1><p>Token exchange error. Please try again.</p></body></html>');
        cleanupFlow();
      });
  });

  // Start listening on a random port
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  callbackServer = server;

  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://localhost:${port}/callback`;

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set('code', 'true');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  // Open browser
  const open = (await import('open')).default;
  await open(authUrl.toString());

  logger.info({ port }, 'OAuth flow started, browser opened');

  // Auto-cleanup after timeout
  flowTimeout = setTimeout(() => {
    if (isFlowActive()) {
      logger.warn('OAuth flow timed out after 5 minutes');
      cleanupFlow();
    }
  }, FLOW_TIMEOUT_MS);
}

import { getAuthInfo } from './api-key-provider.js';

/**
 * Builds an environment record for Claude Code SDK subprocesses,
 * inheriting the current process env and adding the correct auth
 * variable (ANTHROPIC_API_KEY for api_key, CLAUDE_CODE_OAUTH_TOKEN
 * for OAuth).
 */
export function buildAuthEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }

  const auth = getAuthInfo();
  if (auth.token) {
    if (auth.type === 'api_key') {
      env.ANTHROPIC_API_KEY = auth.token;
    } else if (auth.type === 'oauth') {
      env.CLAUDE_CODE_OAUTH_TOKEN = auth.token;
    }
  }

  return env;
}

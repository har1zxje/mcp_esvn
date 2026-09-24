import 'dotenv/config';
import fs from 'node:fs';
import { parse } from 'dotenv';

const required = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
};

const parseModelMap = () => {
  const raw = required('CHAT_MODEL_MAP_JSON');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`CHAT_MODEL_MAP_JSON must be valid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CHAT_MODEL_MAP_JSON must be an object keyed by modelId');
  }

  for (const [modelId, entry] of Object.entries(parsed)) {
    if (!entry || typeof entry !== 'object' || !entry.agentId) {
      throw new Error(`Model mapping "${modelId}" must contain agentId`);
    }
  }
  return parsed;
};

const origins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const loadServerGoogleKey = () => {
  if (process.env.GOOGLE_KEY) return process.env.GOOGLE_KEY;
  const libreChatEnv = new URL('../../LibreChat/.env', import.meta.url);
  try {
    return parse(fs.readFileSync(libreChatEnv, 'utf8')).GOOGLE_KEY ?? '';
  } catch {
    return '';
  }
};

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3091),
  databaseUrl: process.env.DATABASE_URL ?? '',
  databaseHost: process.env.DB_HOST ?? '127.0.0.1',
  databasePort: Number(process.env.DB_PORT ?? 5432),
  databaseName: process.env.DB_NAME ?? 'mcpserver',
  databaseUser: process.env.DB_USER ?? 'postgres',
  databasePassword: process.env.DB_PASSWORD,
  // Optional model/UI integration. Authentication does not use this service.
  libreChatUrl: (process.env.LIBRECHAT_URL ?? 'http://127.0.0.1:3080').replace(/\/$/, ''),
  // Optional server-to-server credential. It never reaches the browser.
  libreChatServiceToken: process.env.LIBRECHAT_SERVICE_TOKEN ?? '',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  projectFrontendUrl: (process.env.PROJECT_FRONTEND_URL ?? 'http://localhost:3090').replace(/\/$/, ''),
  // Use the browser-facing origin in development; Vite proxies this callback
  // to the backend, allowing the cookie to belong to the frontend host.
  authCallbackUrl: process.env.AUTH_CALLBACK_URL ?? `${(process.env.PROJECT_FRONTEND_URL ?? 'http://localhost:3090').replace(/\/$/, '')}/api/auth/google/callback`,
  authCookieSecure: process.env.AUTH_COOKIE_SECURE === 'true',
  authSessionTtlMs: Number(process.env.AUTH_SESSION_TTL_MS ?? 604800000),
  corsOrigins: origins,
  defaultModelId: process.env.CHAT_DEFAULT_MODEL_ID ?? '',
  modelMap: parseModelMap(),
  googleKey: loadServerGoogleKey(),
  maxToolIterations: Number(process.env.MAX_TOOL_ITERATIONS ?? 10),
  contextMessageLimit: Number(process.env.CONTEXT_MESSAGE_LIMIT ?? 24),
  modelTimeoutMs: Number(process.env.MODEL_TIMEOUT_MS ?? 30000),
  mcpTimeoutMs: Number(process.env.MCP_TIMEOUT_MS ?? 15000),
  mcpInternalToken: process.env.MCP_INTERNAL_TOKEN ?? '',
  discordValidationUrl: process.env.DISCORD_VALIDATION_URL ?? 'http://127.0.0.1:3002/internal/discord/destination',
  integrationEncryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY ?? '',
  planeBaseUrl: process.env.PLANE_BASE_URL ?? 'https://api.plane.so/',
  planeValidationTimeoutMs: Number(process.env.PLANE_VALIDATION_TIMEOUT_MS ?? 10000),
  planeClientId: process.env.PLANE_OAUTH_CLIENT_ID ?? process.env.PLANE_CLIENT_ID ?? '',
  planeClientSecret: process.env.PLANE_OAUTH_CLIENT_SECRET ?? process.env.PLANE_CLIENT_SECRET ?? '',
  planeOAuthAuthorizeUrl: process.env.PLANE_OAUTH_AUTHORIZE_URL ?? '',
  planeOAuthTokenUrl: process.env.PLANE_OAUTH_TOKEN_URL ?? '',
  planeOAuthRedirectUri: process.env.PLANE_OAUTH_REDIRECT_URI ?? process.env.PLANE_REDIRECT_URI ?? '',
  planeOAuthScopes: process.env.PLANE_OAUTH_SCOPES ?? '',
  discordClientId: process.env.DISCORD_CLIENT_ID ?? '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
  discordOAuthRedirectUri: process.env.DISCORD_REDIRECT_URI ?? '',
  discordBotPermissions: process.env.DISCORD_BOT_PERMISSIONS ?? '2048',
  discordDiscoveryUrl: process.env.DISCORD_DISCOVERY_URL ?? 'http://127.0.0.1:3002/internal/discord',
  oauthStateTtlMs: Number(process.env.OAUTH_STATE_TTL_MS ?? 600000),
  mcpServers: parseMcpServers(),
};

function parseMcpServers() {
  const raw = process.env.MCP_SERVERS_JSON ?? '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`MCP_SERVERS_JSON must be valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP_SERVERS_JSON must be an object keyed by server name');
  }
  return Object.fromEntries(Object.entries(parsed).map(([name, value]) => [name, {
    url: value.url,
    transport: value.transport ?? 'streamable-http',
    enabled: value.enabled !== false,
  }]));
}

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

if (!Number.isInteger(config.modelTimeoutMs) || config.modelTimeoutMs < 1000) {
  throw new Error('MODEL_TIMEOUT_MS must be an integer >= 1000');
}

if (!Number.isInteger(config.mcpTimeoutMs) || config.mcpTimeoutMs < 1000) {
  throw new Error('MCP_TIMEOUT_MS must be an integer >= 1000');
}

if (!Number.isInteger(config.planeValidationTimeoutMs) || config.planeValidationTimeoutMs < 1000) {
  throw new Error('PLANE_VALIDATION_TIMEOUT_MS must be an integer >= 1000');
}

if (!Number.isInteger(config.authSessionTtlMs) || config.authSessionTtlMs < 60_000) {
  throw new Error('AUTH_SESSION_TTL_MS must be an integer >= 60000');
}

if (config.defaultModelId && !config.modelMap[config.defaultModelId]) {
  throw new Error(`CHAT_DEFAULT_MODEL_ID is not present in CHAT_MODEL_MAP_JSON`);
}

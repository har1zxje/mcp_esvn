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
  libreChatUrl: required('LIBRECHAT_URL').replace(/\/$/, ''),
  // Optional server-to-server credential. It never reaches the browser.
  libreChatServiceToken: process.env.LIBRECHAT_SERVICE_TOKEN ?? '',
  corsOrigins: origins,
  defaultModelId: process.env.CHAT_DEFAULT_MODEL_ID ?? '',
  modelMap: parseModelMap(),
  googleKey: loadServerGoogleKey(),
  maxToolIterations: Number(process.env.MAX_TOOL_ITERATIONS ?? 10),
  contextMessageLimit: Number(process.env.CONTEXT_MESSAGE_LIMIT ?? 24),
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

if (config.defaultModelId && !config.modelMap[config.defaultModelId]) {
  throw new Error(`CHAT_DEFAULT_MODEL_ID is not present in CHAT_MODEL_MAP_JSON`);
}

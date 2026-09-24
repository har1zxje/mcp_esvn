export const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
export const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

export function buildDiscordAuthorizationUrl(config, state) {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.search = new URLSearchParams({ response_type: 'code', client_id: config.discordClientId, redirect_uri: config.discordOAuthRedirectUri, scope: 'identify guilds bot', state, permissions: String(config.discordBotPermissions || '2048'), integration_type: '0' }).toString();
  return url.toString();
}

export async function exchangeDiscordCode(code, config, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(DISCORD_TOKEN_URL, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: config.discordClientId, client_secret: config.discordClientSecret, redirect_uri: config.discordOAuthRedirectUri }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string') { const error = new Error('Discord authorization could not be completed'); error.statusCode = response.status >= 500 ? 503 : 400; error.code = 'DISCORD_OAUTH_FAILED'; throw error; }
  return payload;
}

export async function fetchDiscordInternal(path, { accessToken, config, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${config.discordDiscoveryUrl}${path}`, { headers: { accept: 'application/json', 'x-mcp-internal-token': config.mcpInternalToken, authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) { const error = new Error(payload?.error || 'Discord discovery failed'); error.statusCode = response.status >= 500 ? 503 : 400; error.code = 'DISCORD_DISCOVERY_FAILED'; throw error; }
  return payload;
}


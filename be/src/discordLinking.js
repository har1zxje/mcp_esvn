export class DiscordDestinationError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'DiscordDestinationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const snowflake = /^\d{17,20}$/;

export async function validateDiscordDestination(guildId, channelId, { validationUrl, internalToken, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!snowflake.test(String(guildId ?? '')) || !snowflake.test(String(channelId ?? ''))) {
    throw new DiscordDestinationError('DISCORD_DESTINATION_INVALID', 'Discord guild and channel IDs are invalid');
  }
  if (!validationUrl || !internalToken) {
    throw new DiscordDestinationError('DISCORD_CONTEXT_INVALID', 'Discord validation is not configured', 503);
  }
  let response;
  try {
    response = await fetchImpl(validationUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mcp-internal-token': internalToken },
      body: JSON.stringify({ guildId: String(guildId), channelId: String(channelId) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new DiscordDestinationError('DISCORD_UNAVAILABLE', 'Discord validation timed out', 503);
    }
    throw new DiscordDestinationError('DISCORD_UNAVAILABLE', 'Discord validation is unavailable', 503);
  }
  if (response.status === 401 || response.status === 403) throw new DiscordDestinationError('DISCORD_DESTINATION_FORBIDDEN', 'Discord destination is not accessible by the application bot', 403);
  if (!response.ok) throw new DiscordDestinationError('DISCORD_DESTINATION_INVALID', 'Discord destination validation failed');
  let result;
  try { result = await response.json(); } catch { throw new DiscordDestinationError('DISCORD_INVALID_RESPONSE', 'Discord returned an invalid validation response', 502); }
  if (result?.valid !== true || result.guildId !== String(guildId) || result.channelId !== String(channelId)) {
    throw new DiscordDestinationError('DISCORD_INVALID_RESPONSE', 'Discord returned an invalid destination response', 502);
  }
  return {
    valid: true,
    guildId: String(guildId),
    channelId: String(channelId),
    guildName: typeof result.guildName === 'string' ? result.guildName : null,
    channelName: typeof result.channelName === 'string' ? result.channelName : null,
  };
}

export async function connectDiscordIntegration(userId, body, { validate = validateDiscordDestination, saveIntegration, validationUrl, internalToken, timeoutMs } = {}) {
  const validation = await validate(body?.guildId, body?.channelId, { validationUrl, internalToken, timeoutMs });
  return saveIntegration(userId, 'discord', {
    guildId: validation.guildId,
    channelId: validation.channelId,
    metadata: {
      notificationMode: 'channel',
      ...(validation.guildName ? { guildName: validation.guildName } : {}),
      ...(validation.channelName ? { channelName: validation.channelName } : {}),
    },
  }, { allowCredentialless: true });
}

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { IntegrationService } = await import('../src/integrationService.js');
const { connectDiscordIntegration, validateDiscordDestination } = await import('../src/discordLinking.js');

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-discord-link-'));
  const service = new IntegrationService({ filePath: path.join(directory, 'user_integrations.json'), encryptionKey: crypto.randomBytes(32).toString('hex') });
  return { directory, service };
}

function response(status, payload) {
  return new Response(payload === undefined ? '' : JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

test('validates and stores separate Discord destinations without storing the bot token', async () => {
  const { directory, service } = await fixture();
  try {
    const validate = async (guildId, channelId) => ({ valid: true, guildId, channelId, guildName: 'Guild', channelName: 'alerts' });
    await Promise.all([
      connectDiscordIntegration('user-a', { userId: 'user-b', guildId: '111111111111111111', channelId: '222222222222222222' }, { validate, saveIntegration: (userId, provider, data, options) => service.saveIntegration(userId, provider, data, options) }),
      connectDiscordIntegration('user-b', { guildId: '333333333333333333', channelId: '444444444444444444' }, { validate, saveIntegration: (userId, provider, data, options) => service.saveIntegration(userId, provider, data, options) }),
    ]);
    const a = await service.getSafeIntegration('user-a', 'discord');
    const b = await service.getSafeIntegration('user-b', 'discord');
    assert.equal(a.guildId, '111111111111111111');
    assert.equal(a.channelId, '222222222222222222');
    assert.equal(b.guildId, '333333333333333333');
    assert.equal(b.channelId, '444444444444444444');
    const raw = await fs.readFile(service.filePath, 'utf8');
    assert.equal(raw.includes('DiscordBotToken'), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Discord destination validation uses the trusted internal endpoint and rejects bad destinations', async () => {
  let request;
  const result = await validateDiscordDestination('111111111111111111', '222222222222222222', {
    validationUrl: 'http://discord.test/internal/discord/destination',
    internalToken: 'internal-token',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(200, { valid: true, guildId: '111111111111111111', channelId: '222222222222222222' });
    },
  });
  assert.equal(result.valid, true);
  assert.equal(request.init.headers['x-mcp-internal-token'], 'internal-token');
  assert.deepEqual(JSON.parse(request.init.body), { guildId: '111111111111111111', channelId: '222222222222222222' });
  await assert.rejects(validateDiscordDestination('bad', '222222222222222222', { validationUrl: 'http://discord.test', internalToken: 'internal' }), /IDs are invalid/);
});

test('Discord validation failure does not persist a mapping', async () => {
  const { directory, service } = await fixture();
  try {
    await assert.rejects(connectDiscordIntegration('user-a', { guildId: '111111111111111111', channelId: '222222222222222222' }, {
      validate: async () => { throw Object.assign(new Error('not accessible'), { code: 'DISCORD_DESTINATION_FORBIDDEN' }); },
      saveIntegration: (userId, provider, data, options) => service.saveIntegration(userId, provider, data, options),
    }), /not accessible/);
    assert.equal(await service.getIntegration('user-a', 'discord'), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

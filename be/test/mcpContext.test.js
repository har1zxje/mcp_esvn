import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LIBRECHAT_URL = 'http://librechat.test';
process.env.CHAT_MODEL_MAP_JSON = '{"test":{"agentId":"agent"}}';
process.env.CHAT_DEFAULT_MODEL_ID = 'test';
process.env.MCP_SERVERS_JSON = '{}';
process.env.MCP_INTERNAL_TOKEN = 'internal-test-token';

const { ToolRegistry } = await import('../src/toolRegistry.js');

function registryWithRecorder(records, resolver) {
  const client = {
    async listTools() {
      return [{ name: 'find_work_items', description: 'find', inputSchema: { type: 'object' } }];
    },
    async callTool(name, args, signal, headers) {
      records.push({ name, args, signal, headers });
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
  const registry = new ToolRegistry(new Map([['plane', client]]), resolver);
  return { registry, client };
}

test('concurrent users receive their own Plane key and model userId cannot override context', async () => {
  const records = [];
  const { registry } = registryWithRecorder(records, async (userId) => {
    await new Promise((resolve) => setTimeout(resolve, userId === 'user-a' ? 10 : 1));
    return { userId, apiKey: userId === 'user-a' ? 'key-a' : 'key-b' };
  });
  await registry.refresh();
  const [a, b] = await Promise.all([
    registry.execute('plane__find_work_items', { userId: 'user-b', name: 'task' }, 'find Plane work', undefined, { userId: 'user-a' }),
    registry.execute('plane__find_work_items', { name: 'task' }, 'find Plane work', undefined, { userId: 'user-b' }),
  ]);
  assert.equal(a.success, true);
  assert.equal(b.success, true);
  assert.deepEqual(records.map((record) => record.headers['x-plane-api-key']).sort(), ['key-a', 'key-b']);
  assert.deepEqual(records.map((record) => record.headers['x-mcp-user-id']).sort(), ['user-a', 'user-b']);
  assert.equal(records.find((record) => record.headers['x-plane-api-key'] === 'key-a').args.userId, 'user-b');
});

test('missing Plane integration fails without invoking MCP and without fallback', async () => {
  const records = [];
  const { registry } = registryWithRecorder(records, async () => {
    throw Object.assign(new Error('Plane account is not connected for this user.'), { code: 'PLANE_NOT_CONNECTED' });
  });
  await registry.refresh();
  const result = await registry.execute('plane__find_work_items', {}, 'find Plane work', undefined, { userId: 'user-c' });
  assert.equal(result.success, false);
  assert.deepEqual(result.error, { code: 'PLANE_NOT_CONNECTED', message: 'Plane account is not connected for this user.' });
  assert.equal(records.length, 0);
});

test('concurrent Discord notifications use trusted per-user destinations', async () => {
  const records = [];
  const client = {
    async listTools() { return [{ name: 'send_discord_message', inputSchema: { type: 'object' } }]; },
    async callTool(name, args, signal, headers) { records.push({ name, args, signal, headers }); return { content: [{ type: 'text', text: 'ok' }] }; },
  };
  const registry = new ToolRegistry(new Map([['discord', client]]), async (userId) => ({
    userId,
    guildId: userId === 'user-a' ? '111111111111111111' : '333333333333333333',
    channelId: userId === 'user-a' ? '222222222222222222' : '444444444444444444',
  }));
  await registry.refresh();
  await Promise.all([
    registry.execute('discord__send_discord_message', { channelId: '444444444444444444' }, 'send Discord notification', undefined, { userId: 'user-a' }),
    registry.execute('discord__send_discord_message', {}, 'send Discord notification', undefined, { userId: 'user-b' }),
  ]);
  assert.deepEqual(records.map((record) => record.headers['x-discord-channel-id']).sort(), ['222222222222222222', '444444444444444444']);
  assert.deepEqual(records.map((record) => record.headers['x-mcp-user-id']).sort(), ['user-a', 'user-b']);
});

test('Discord missing integration fails closed and model destination cannot override trusted context', async () => {
  const records = [];
  const client = {
    async listTools() { return [{ name: 'send_discord_message', inputSchema: { type: 'object' } }]; },
    async callTool(name, args, signal, headers) { records.push({ name, args, signal, headers }); return { content: [{ type: 'text', text: 'ok' }] }; },
  };
  const registry = new ToolRegistry(new Map([['discord', client]]), async (userId) => {
    if (userId === 'missing-user') throw Object.assign(new Error('Discord destination is not configured for this user.'), { code: 'DISCORD_NOT_CONNECTED' });
    return { userId, guildId: '111111111111111111', channelId: '222222222222222222' };
  });
  await registry.refresh();
  const missing = await registry.execute('discord__send_discord_message', {}, 'send Discord notification', undefined, { userId: 'missing-user' });
  assert.equal(missing.success, false);
  assert.equal(missing.error.code, 'DISCORD_NOT_CONNECTED');
  assert.equal(records.length, 0);
  const connected = await registry.execute('discord__send_discord_message', { guildId: '999999999999999999', channelId: '999999999999999999' }, 'send Discord notification', undefined, { userId: 'user-a' });
  assert.equal(connected.success, true);
  assert.equal(records[0].headers['x-mcp-user-id'], 'user-a');
  assert.equal(records[0].headers['x-discord-guild-id'], '111111111111111111');
  assert.equal(records[0].headers['x-discord-channel-id'], '222222222222222222');
});

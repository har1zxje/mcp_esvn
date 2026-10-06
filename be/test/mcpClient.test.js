import assert from 'node:assert/strict';
import test from 'node:test';

process.env.MCP_SERVERS_JSON = '{}';
process.env.MCP_INTERNAL_TOKEN = 'test-internal-token';
const { McpClient } = await import('../src/mcpClient.js');

test('HRM MCP lifecycle sends trusted headers and isolates transport sessions by user/company', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const headers = Object.fromEntries(new Headers(options.headers).entries());
    calls.push({ body: JSON.parse(options.body), headers });
    const userId = headers['x-mcp-user-id'];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(options.body).id ?? null, result: JSON.parse(options.body).method === 'tools/list' ? { tools: [] } : {} }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': `session-${userId}` },
    });
  };
  try {
    const client = new McpClient('hrm', { url: 'http://hrm-mcp.test/mcp', internalToken: 'test-internal-token' });
    const contextA = { 'x-mcp-user-id': 'user-a', 'x-mcp-company-id': 'company-a', 'x-mcp-request-id': 'request-a' };
    const contextB = { 'x-mcp-user-id': 'user-b', 'x-mcp-company-id': 'company-b', 'x-mcp-request-id': 'request-b' };
    await Promise.all([client.listTools(undefined, contextA), client.listTools(undefined, contextB)]);
    await client.callTool('get_my_profile', {}, undefined, contextA);

    const aCalls = calls.filter((call) => call.headers['x-mcp-user-id'] === 'user-a');
    const bCalls = calls.filter((call) => call.headers['x-mcp-user-id'] === 'user-b');
    assert.equal(aCalls.length, 4);
    assert.equal(bCalls.length, 3);
    for (const call of aCalls) {
      assert.equal(call.headers['x-mcp-company-id'], 'company-a');
      assert.equal(call.headers['x-mcp-request-id'], 'request-a');
      assert.equal(call.headers['x-mcp-internal-token'], 'test-internal-token');
    }
    for (const call of bCalls) {
      assert.equal(call.headers['x-mcp-company-id'], 'company-b');
      assert.equal(call.headers['x-mcp-request-id'], 'request-b');
      assert.equal(call.headers['x-mcp-internal-token'], 'test-internal-token');
    }
    const finalCall = aCalls.at(-1);
    assert.equal(finalCall.headers['mcp-session-id'], 'session-user-a');
    assert.notEqual(finalCall.headers['mcp-session-id'], 'session-user-b');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

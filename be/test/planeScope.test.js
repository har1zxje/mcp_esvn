import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaneScopeService, normalizePlaneScope } from '../src/planeScope.js';

test('Plane scope is validated against only the authenticated user credential and stored safely', async () => {
  const calls = []; let saved;
  const integrations = {
    async getIntegration(userId) { assert.equal(userId, 'user-a'); return { accessToken: 'secret-a', credentialType: 'oauth', metadata: { accountName: 'A' } }; },
    async saveIntegration(userId, provider, value) { saved = { userId, provider, value }; return { connected: true, workspaceSlug: value.workspaceSlug, metadata: value.metadata }; },
  };
  const client = { async callTool(...args) { calls.push(args); return { content: [{ type: 'text', text: JSON.stringify({ results: [{ id: 'project-a', name: 'Project A' }] }) }] }; } };
  const service = new PlaneScopeService(client, integrations);
  const result = await service.saveScope('user-a', { workspaceSlug: 'workspace-a', projectId: 'project-a', userId: 'user-b' });
  assert.deepEqual(result.metadata, { accountName: 'A', defaultProjectId: 'project-a', defaultProjectName: 'Project A' });
  assert.equal(calls[0][3]['x-mcp-user-id'], 'user-a');
  assert.equal(calls[0][3]['x-plane-workspace'], 'workspace-a');
  assert.equal(calls[0][3]['x-plane-credential'], 'secret-a');
  assert.equal(calls[0][3]['x-plane-api-key'], undefined);
  assert.deepEqual(saved, { userId: 'user-a', provider: 'plane', value: { workspaceSlug: 'workspace-a', metadata: { accountName: 'A', defaultProjectId: 'project-a', defaultProjectName: 'Project A' } } });
});

test('Plane scope rejects malformed values and projects unavailable to the user', async () => {
  assert.throws(() => normalizePlaneScope({ workspaceSlug: '../bad', projectId: 'project-a' }), (error) => error.code === 'PLANE_SCOPE_INVALID');
  const service = new PlaneScopeService({ async callTool() { return { content: [{ type: 'text', text: '{"results":[]}' }] }; } }, { async getIntegration() { return { accessToken: 'secret' }; }, async saveIntegration() { throw new Error('must not save'); } });
  await assert.rejects(service.saveScope('user-a', { workspaceSlug: 'workspace-a', projectId: 'project-a' }), (error) => error.code === 'PLANE_SCOPE_FORBIDDEN');
});

test('project discovery resolves the current user OAuth credential before MCP and preserves a provider 401 as reauthorization required', async () => {
  const operations = [];
  const service = new PlaneScopeService(
    { async callTool(_tool, _args, _signal, headers) {
      assert.equal(headers['x-plane-credential'], 'refreshed-b');
      assert.equal(headers['x-plane-auth-type'], 'oauth');
      return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'PLANE_AUTH_REQUIRED' } }) }], isError: true };
    } },
    { async getIntegration() { return { accessToken: 'expired-b', credentialType: 'oauth' }; } },
    { async resolve(userId, context) { operations.push({ userId, context }); return { integration: { accessToken: 'refreshed-b', credentialType: 'oauth' }, credential: 'refreshed-b', authType: 'oauth' }; } },
  );
  await assert.rejects(service.listProjects('user-b', 'maybaymcp'), (error) => error.code === 'PLANE_REAUTH_REQUIRED' && error.statusCode === 401);
  assert.deepEqual(operations, [{ userId: 'user-b', context: { operation: 'plane.list_projects', workspaceSlug: 'maybaymcp' } }]);
});

test('a stale default project is cleared only for its owner before mutation', async () => {
  const saves = [];
  const userB = { accessToken: 'secret-b', credentialType: 'oauth', workspaceSlug: 'workspace-b', metadata: { defaultProjectId: 'removed-project', defaultProjectName: 'Removed' } };
  const integrations = {
    async getIntegration(userId) { assert.equal(userId, 'user-b'); return userB; },
    async saveIntegration(userId, provider, value) { saves.push({ userId, provider, value }); },
  };
  const client = { async callTool(_tool, _args, _signal, headers) {
    assert.equal(headers['x-mcp-user-id'], 'user-b');
    assert.equal(headers['x-plane-credential'], 'secret-b');
    return { content: [{ type: 'text', text: JSON.stringify({ results: [{ id: 'project-b', name: 'B' }] }) }] };
  } };
  const service = new PlaneScopeService(client, integrations);
  await assert.rejects(service.validateDefaultProject('user-b'), (error) => error.code === 'PLANE_SCOPE_STALE');
  assert.deepEqual(saves, [{ userId: 'user-b', provider: 'plane', value: { workspaceSlug: 'workspace-b', metadata: {} } }]);
});

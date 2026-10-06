import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaneCredentialService, credentialFingerprint } from '../src/planeCredentialService.js';

function fakeIntegrations(records) {
  const data = new Map(Object.entries(records));
  return {
    async getIntegration(userId) { return data.get(userId) ? structuredClone(data.get(userId)) : null; },
    async saveIntegration(userId, _provider, update) {
      const current = data.get(userId);
      assert.ok(current, `must update only existing authenticated owner ${userId}`);
      data.set(userId, { ...current, ...update });
    },
  };
}

const oauthConfig = { planeOAuthTokenUrl: 'https://plane.example/token', planeClientId: 'client', planeClientSecret: 'secret' };

test('expired User B OAuth credential refreshes and persists only User B before the credential is injected', async () => {
  const integrations = fakeIntegrations({
    'user-a': { accessToken: 'access-a', refreshToken: 'refresh-a', credentialType: 'oauth', expiresAt: '2030-01-01T00:00:00.000Z', externalUserId: 'plane-a' },
    'user-b': { accessToken: 'expired-b', refreshToken: 'refresh-b', credentialType: 'oauth', expiresAt: '2020-01-01T00:00:00.000Z', externalUserId: 'plane-b' },
  });
  const refreshes = [];
  const service = new PlaneCredentialService({
    integrations, config: oauthConfig, now: () => Date.parse('2026-09-28T00:00:00Z'), logger: { info() {}, warn() {} },
    refreshToken: async (refreshToken) => { refreshes.push(refreshToken); return { access_token: 'access-b-new', refresh_token: 'refresh-b-new', expires_in: 3600 }; },
  });

  const result = await service.resolve('user-b', { operation: 'plane.list_projects', workspaceSlug: 'maybaymcp' });
  assert.equal(result.credential, 'access-b-new');
  assert.equal(result.integration.externalUserId, 'plane-b');
  assert.deepEqual(refreshes, ['refresh-b']);
  assert.equal((await integrations.getIntegration('user-a')).accessToken, 'access-a');
  assert.equal((await integrations.getIntegration('user-a')).refreshToken, 'refresh-a');
  assert.equal((await integrations.getIntegration('user-b')).accessToken, 'access-b-new');
  assert.notEqual(credentialFingerprint('access-a'), credentialFingerprint('access-b-new'));
});

test('concurrent requests for one expired user share that user refresh only', async () => {
  const integrations = fakeIntegrations({ 'user-b': { accessToken: 'expired-b', refreshToken: 'refresh-b', credentialType: 'oauth', expiresAt: '2020-01-01T00:00:00.000Z' } });
  let calls = 0;
  const service = new PlaneCredentialService({
    integrations, config: oauthConfig, now: () => Date.parse('2026-09-28T00:00:00Z'), logger: { info() {}, warn() {} },
    refreshToken: async () => { calls += 1; return { access_token: 'access-b-new', expires_in: 3600 }; },
  });
  const [first, second] = await Promise.all([service.resolve('user-b'), service.resolve('user-b')]);
  assert.equal(calls, 1);
  assert.equal(first.credential, 'access-b-new');
  assert.equal(second.credential, 'access-b-new');
});

test('failed OAuth refresh fails closed as PLANE_REAUTH_REQUIRED and never falls back to another user token', async () => {
  const integrations = fakeIntegrations({
    'user-a': { accessToken: 'access-a', credentialType: 'oauth', expiresAt: '2030-01-01T00:00:00.000Z' },
    'user-b': { accessToken: 'expired-b', refreshToken: 'revoked-b', credentialType: 'oauth', expiresAt: '2020-01-01T00:00:00.000Z' },
  });
  const service = new PlaneCredentialService({
    integrations, config: oauthConfig, now: () => Date.parse('2026-09-28T00:00:00Z'), logger: { info() {}, warn() {} },
    refreshToken: async () => { throw Object.assign(new Error('invalid_grant'), { code: 'PLANE_OAUTH_REFRESH_FAILED' }); },
  });
  await assert.rejects(service.resolve('user-b'), (error) => error.code === 'PLANE_REAUTH_REQUIRED');
  assert.equal((await integrations.getIntegration('user-a')).accessToken, 'access-a');
  assert.equal((await integrations.getIntegration('user-b')).accessToken, 'expired-b');
});

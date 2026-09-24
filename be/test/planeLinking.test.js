import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { IntegrationService } = await import('../src/integrationService.js');
const { connectPlaneIntegration, validatePlaneCredential } = await import('../src/planeLinking.js');

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-plane-link-'));
  const filePath = path.join(directory, 'user_integrations.json');
  const service = new IntegrationService({ filePath, encryptionKey: crypto.randomBytes(32).toString('hex') });
  return { directory, filePath, service };
}

function response(status, payload) {
  return new Response(payload === undefined ? '' : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('validates a Plane personal API key with X-API-Key and stores safe identity metadata', async () => {
  const { directory, filePath, service } = await fixture();
  let request;
  try {
    const integration = await connectPlaneIntegration('user-a', { token: 'plane-token-a', userId: 'user-b' }, {
      baseUrl: 'https://plane.example.test/',
      validate: (token, options) => validatePlaneCredential(token, {
        ...options,
        fetchImpl: async (url, init) => {
          request = { url: String(url), init };
          return response(200, { id: 'plane-user-a', email: 'a@example.test' });
        },
      }),
      saveIntegration: (userId, provider, credentials) => service.saveIntegration(userId, provider, credentials),
    });
    assert.equal(request.url, 'https://plane.example.test/api/v1/users/me/');
    assert.equal(request.init.headers['X-API-Key'], 'plane-token-a');
    assert.equal(integration.externalUserId, 'plane-user-a');
    assert.equal('accessToken' in integration, false);
    assert.equal((await service.getIntegration('user-a', 'plane')).accessToken, 'plane-token-a');
    assert.equal(await service.getIntegration('user-b', 'plane'), null);
    const stored = await fs.readFile(filePath, 'utf8');
    assert.equal(stored.includes('plane-token-a'), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('invalid Plane credentials are rejected before persistence', async () => {
  const { directory, service } = await fixture();
  try {
    await assert.rejects(
      connectPlaneIntegration('user-a', { token: 'invalid-token' }, {
        baseUrl: 'https://plane.example.test',
        validate: (token, options) => validatePlaneCredential(token, {
          ...options,
          fetchImpl: async () => response(401, { detail: 'do not expose this' }),
        }),
        saveIntegration: (userId, provider, credentials) => service.saveIntegration(userId, provider, credentials),
      }),
      (error) => error.code === 'PLANE_UNAUTHORIZED' && !error.message.includes('do not expose this'),
    );
    assert.equal(await service.getIntegration('user-a', 'plane'), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Plane validation handles unavailable and malformed responses safely', async () => {
  await assert.rejects(
    validatePlaneCredential('token', { baseUrl: 'https://plane.example.test', fetchImpl: async () => { throw new Error('network token=secret'); } }),
    (error) => error.code === 'PLANE_UNAVAILABLE' && !error.message.includes('secret'),
  );
  await assert.rejects(
    validatePlaneCredential('token', { baseUrl: 'https://plane.example.test', fetchImpl: async () => response(200, { email: 'missing-id@example.test' }) }),
    (error) => error.code === 'PLANE_INVALID_RESPONSE',
  );
});

test('user-controlled Plane base URLs are rejected unless local HTTPS testing is used', async () => {
  await assert.rejects(
    validatePlaneCredential('token', { baseUrl: 'http://attacker.example.test' }),
    (error) => error.code === 'PLANE_CONFIGURATION_ERROR',
  );
});

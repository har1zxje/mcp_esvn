import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { IntegrationService } = await import('../src/integrationService.js');

async function createService() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-integrations-'));
  const filePath = path.join(directory, 'user_integrations.json');
  const service = new IntegrationService({
    filePath,
    encryptionKey: crypto.randomBytes(32).toString('hex'),
  });
  return { service, filePath, directory };
}

test('stores and retrieves separate Plane integrations per user', async () => {
  const { service, filePath, directory } = await createService();
  try {
    await service.saveIntegration('user-a', 'plane', { accessToken: 'plane-token-a', workspaceId: 'workspace-a' });
    await service.saveIntegration('user-b', 'plane', { accessToken: 'plane-token-b', workspaceId: 'workspace-b' });

    assert.equal((await service.getIntegration('user-a', 'plane')).accessToken, 'plane-token-a');
    assert.equal((await service.getIntegration('user-b', 'plane')).accessToken, 'plane-token-b');
    assert.equal((await service.getIntegration('user-a', 'plane')).workspaceId, 'workspace-a');
    assert.equal((await service.getIntegration('user-b', 'plane')).workspaceId, 'workspace-b');

    const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(stored.integrations.length, 2);
    assert.equal(stored.integrations.some((entry) => entry.accessTokenEncrypted === 'plane-token-a'), false);
    assert.equal(stored.integrations.some((entry) => entry.accessTokenEncrypted === 'plane-token-b'), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('provider lookup is scoped and disconnect only removes the current user record', async () => {
  const { service, directory } = await createService();
  try {
    await service.saveIntegration('user-a', 'plane', { accessToken: 'a' });
    await service.saveIntegration('user-a', 'discord', { accessToken: 'discord-a', guildId: 'guild-a' });
    await service.saveIntegration('user-b', 'plane', { accessToken: 'b' });
    assert.equal(await service.hasIntegration('user-a', 'discord'), true);
    assert.equal(await service.getIntegration('user-b', 'discord'), null);

    await service.disconnectIntegration('user-a', 'plane');
    assert.equal(await service.getIntegration('user-a', 'plane'), null);
    assert.equal((await service.getIntegration('user-b', 'plane')).accessToken, 'b');
    assert.equal((await service.getIntegration('user-a', 'discord')).accessToken, 'discord-a');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('safe integration responses do not expose credentials', async () => {
  const { service, directory } = await createService();
  try {
    await service.saveIntegration('user-a', 'plane', { accessToken: 'secret-access', refreshToken: 'secret-refresh', metadata: { label: 'work' } });
    const safe = await service.getSafeIntegration('user-a', 'plane');
    assert.equal(safe.connected, true);
    assert.equal('accessToken' in safe, false);
    assert.equal('refreshToken' in safe, false);
    assert.equal(JSON.stringify(safe).includes('secret-'), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('OAuth integration stores encrypted credentials and exposes safe account/workspace metadata', async () => {
  const { service, filePath, directory } = await createService();
  try {
    const safe = await service.saveIntegration('user-a', 'plane', {
      accessToken: 'oauth-access-secret',
      refreshToken: 'oauth-refresh-secret',
      credentialType: 'oauth',
      externalUserId: 'plane-user-a',
      workspaceId: 'workspace-a',
      workspaceSlug: 'workspace-slug-a',
      metadata: { accountName: 'User A', workspaceName: 'Workspace A', authType: 'oauth' },
    });
    assert.equal(safe.credentialType, 'oauth');
    assert.equal(safe.externalUserId, 'plane-user-a');
    assert.equal(safe.workspaceSlug, 'workspace-slug-a');
    assert.equal('accessToken' in safe, false);
    assert.equal('refreshToken' in safe, false);
    const stored = await fs.readFile(filePath, 'utf8');
    assert.equal(stored.includes('oauth-access-secret'), false);
    assert.equal(stored.includes('oauth-refresh-secret'), false);
    assert.equal((await service.getIntegration('user-a', 'plane')).accessToken, 'oauth-access-secret');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('credential metadata cannot be used to smuggle secrets', async () => {
  const { service, directory } = await createService();
  try {
    await assert.rejects(
      service.saveIntegration('user-a', 'plane', { accessToken: 'token', metadata: { accessToken: 'leak' } }),
      /metadata field is not allowed/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

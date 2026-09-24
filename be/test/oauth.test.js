import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuthStateStore } from '../src/oauthState.js';
import { buildDiscordAuthorizationUrl } from '../src/discordOAuth.js';
import { buildPlaneAuthorizationUrl, isPlaneOAuthConfigured, refreshPlaneToken } from '../src/planeOAuth.js';

test('OAuth state is one-time, provider-scoped, and user-bound', () => {
  const store = new OAuthStateStore({ ttlMs: 1000 });
  const invalidState = store.create({ userId: 'user-a', provider: 'discord', returnTo: '/chat/new' });
  assert.equal(store.consume(invalidState, 'plane'), null);
  const state = store.create({ userId: 'user-a', provider: 'discord', returnTo: '/chat/new' });
  const pending = store.consume(state, 'discord');
  assert.equal(pending.userId, 'user-a');
  assert.equal(pending.provider, 'discord');
  assert.equal(pending.returnTo, '/chat/new');
  assert.equal(typeof pending.expiresAt, 'number');
  assert.equal(store.consume(state, 'discord'), null);
});

test('expired OAuth state is rejected', () => {
  const store = new OAuthStateStore({ ttlMs: -1 });
  const state = store.create({ userId: 'user-a', provider: 'plane', returnTo: '/chat/new' });
  assert.equal(store.consume(state, 'plane'), null);
});

test('Plane OAuth is explicit configuration and never invents provider endpoints', () => {
  assert.equal(isPlaneOAuthConfigured({}), false);
  const config = { planeClientId: 'client', planeClientSecret: 'secret', planeOAuthAuthorizeUrl: 'https://plane.example/oauth/authorize', planeOAuthTokenUrl: 'https://plane.example/oauth/token', planeOAuthRedirectUri: 'https://app.example/callback', planeOAuthScopes: 'workspaces:read' };
  const url = new URL(buildPlaneAuthorizationUrl(config, 'state-a'));
  assert.equal(url.searchParams.get('state'), 'state-a');
  assert.equal(url.searchParams.get('client_id'), 'client');
});

test('expired or revoked Plane OAuth refresh fails closed and requires reconnect', async () => {
  await assert.rejects(
    refreshPlaneToken('revoked-refresh-token', {
      planeOAuthTokenUrl: 'https://plane.example/oauth/token',
      planeClientId: 'client',
      planeClientSecret: 'secret',
    }, { fetchImpl: async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }) }),
    (error) => error.code === 'PLANE_OAUTH_REFRESH_FAILED' && error.statusCode === 400 && error.message === 'Plane authorization expired; reconnect is required',
  );
});

test('Discord install URL requests user identity, guild discovery, and bot installation', () => {
  const url = new URL(buildDiscordAuthorizationUrl({ discordClientId: '123', discordOAuthRedirectUri: 'https://app.example/discord/callback', discordBotPermissions: '2048' }, 'state-b'));
  assert.equal(url.searchParams.get('state'), 'state-b');
  assert.match(url.searchParams.get('scope'), /identify/);
  assert.match(url.searchParams.get('scope'), /guilds/);
  assert.match(url.searchParams.get('scope'), /bot/);
});

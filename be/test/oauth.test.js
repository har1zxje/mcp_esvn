import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuthStateStore } from '../src/oauthState.js';
import { buildDiscordAuthorizationUrl } from '../src/discordOAuth.js';
import { buildPlaneAuthorizationUrl, getPlaneProfile, isPlaneOAuthConfigured, refreshPlaneToken, requiredPlaneOAuthScopes, REQUIRED_PLANE_OAUTH_SCOPES } from '../src/planeOAuth.js';

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
  for (const scope of REQUIRED_PLANE_OAUTH_SCOPES) assert.match(url.searchParams.get('scope'), new RegExp(`(?:^| )${scope}(?: |$)`));
  assert.match(url.searchParams.get('scope'), /(?:^| )projects\.states:read(?: |$)/);
});

test('Plane OAuth scopes are staged: state lookup first, project members only when explicitly configured', () => {
  const baseline = 'profile:read projects:read projects.work_items:read projects.work_items:write';
  assert.equal(requiredPlaneOAuthScopes(baseline), `${baseline} projects.states:read`);
  assert.equal(requiredPlaneOAuthScopes(`${baseline} projects.members:read`), `${baseline} projects.members:read projects.states:read`);
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

test('Plane profile diagnostic uses a Bearer token and classifies 401 as reauthorization required', async () => {
  let request;
  const profile = await getPlaneProfile('credential-b', { planeBaseUrl: 'https://plane.example' }, {
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({ id: 'plane-user-b' }), { status: 200 });
    },
  });
  assert.equal(profile.id, 'plane-user-b');
  assert.equal(request.url, 'https://plane.example/api/v1/users/me/');
  assert.equal(request.options.headers.authorization, 'Bearer credential-b');
  assert.equal(request.options.headers['x-api-key'], undefined);
  let patRequest;
  await getPlaneProfile('pat-b', { planeBaseUrl: 'https://plane.example' }, {
    authType: 'pat', fetchImpl: async (_url, options) => {
      patRequest = options;
      return new Response(JSON.stringify({ id: 'plane-user-b' }), { status: 200 });
    },
  });
  assert.equal(patRequest.headers['x-api-key'], 'pat-b');
  assert.equal(patRequest.headers.authorization, undefined);
  await assert.rejects(
    getPlaneProfile('invalid-b', { planeBaseUrl: 'https://plane.example' }, { fetchImpl: async () => new Response('{}', { status: 401 }) }),
    (error) => error.code === 'PLANE_REAUTH_REQUIRED' && error.statusCode === 401,
  );
});

test('Discord install URL requests user identity, guild discovery, and bot installation', () => {
  const url = new URL(buildDiscordAuthorizationUrl({ discordClientId: '123', discordOAuthRedirectUri: 'https://app.example/discord/callback', discordBotPermissions: '2048' }, 'state-b'));
  assert.equal(url.searchParams.get('state'), 'state-b');
  assert.match(url.searchParams.get('scope'), /identify/);
  assert.match(url.searchParams.get('scope'), /guilds/);
  assert.match(url.searchParams.get('scope'), /bot/);
});

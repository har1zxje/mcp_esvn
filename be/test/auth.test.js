import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ApplicationAuthService } from '../src/applicationAuth.js';
import { createRequireAuthenticatedUser } from '../src/auth.js';
import { buildGoogleAuthorizationUrl, createGoogleState, verifyGoogleIdentity } from '../src/googleAuth.js';
import { getAuthenticatedOwnerId, ownsConversation } from '../src/ownership.js';

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-auth-'));
  const auth = new ApplicationAuthService({ filePath: path.join(directory, 'auth.json'), sessionTtlMs: 60_000 });
  return { directory, filePath: path.join(directory, 'auth.json'), auth };
}
function request(headers = {}, extra = {}) { return { get(name) { return headers[name.toLowerCase()] ?? ''; }, ...extra }; }
function response() { return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } }; }

test('unauthenticated protected request is rejected by the application session middleware', async () => {
  const { auth } = await fixture(); const middleware = createRequireAuthenticatedUser({ authService: auth }); const res = response(); let nextCalled = false;
  await middleware(request(), res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401); assert.equal(res.body.code, 'AUTH_REQUIRED'); assert.equal(nextCalled, false);
});

test('expired application session is rejected and does not populate req.user', async () => {
  const { auth } = await fixture();
  const user = await auth.findOrCreateGoogleUser({ providerUserId: 'google-expired', email: 'expired@example.test' });
  const expiredAuth = new ApplicationAuthService({ filePath: auth.filePath, sessionTtlMs: -1 });
  const token = await expiredAuth.createSession(user.id);
  const req = request({ cookie: `project_session=${token}` });
  const res = response();
  await createRequireAuthenticatedUser({ authService: auth })(req, res, () => {});
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'AUTH_REQUIRED');
  assert.equal('user' in req, false);
});

test('Google identity creates a stable application user and session', async () => {
  const { auth } = await fixture();
  const userA = await auth.findOrCreateGoogleUser({ providerUserId: 'google-a', email: 'a@example.test', name: 'A', avatar: null });
  const userAAgain = await auth.findOrCreateGoogleUser({ providerUserId: 'google-a', email: 'a@example.test', name: 'A', avatar: null });
  const userB = await auth.findOrCreateGoogleUser({ providerUserId: 'google-b', email: 'b@example.test', name: 'B', avatar: null });
  assert.equal(userA.id, userAAgain.id); assert.notEqual(userA.id, userB.id);
  const token = await auth.createSession(userA.id); assert.deepEqual(await auth.getUserForSession(token), userA);
  await auth.revokeSession(token); assert.equal(await auth.getUserForSession(token), null);
});

test('local registration hashes the password, normalizes email, and creates a session', async () => {
  const { auth } = await fixture();
  const user = await auth.registerLocalUser({ email: '  Alice@Example.TEST ', password: 'correct horse battery staple' });
  assert.equal(user.email, 'alice@example.test');
  assert.equal(user.name, 'alice@example.test');
  assert.equal('passwordHash' in user, false);
  const store = JSON.parse(await fs.readFile(auth.filePath, 'utf8'));
  assert.equal(store.users.length, 1);
  assert.notEqual(store.users[0].passwordHash, 'correct horse battery staple');
  assert.match(store.users[0].passwordHash, /^\$2[aby]\$/);
  const token = await auth.createSession(user.id);
  assert.equal((await auth.authenticateLocalUser({ email: 'ALICE@example.test', password: 'correct horse battery staple' })).id, user.id);
  assert.equal((await auth.getUserForSession(token)).id, user.id);
});

test('local login rejects wrong password generically and duplicate registration', async () => {
  const { auth } = await fixture();
  await auth.registerLocalUser({ email: 'user@example.test', password: 'correct horse battery staple' });
  await assert.rejects(auth.authenticateLocalUser({ email: 'user@example.test', password: 'wrong password' }), (error) => error.code === 'AUTH_INVALID_CREDENTIALS' && error.statusCode === 401);
  await assert.rejects(auth.registerLocalUser({ email: 'USER@example.test', password: 'another password' }), (error) => error.code === 'AUTH_EMAIL_EXISTS' && error.statusCode === 409);
});

test('Google and local login with the same email share one application user', async () => {
  const { auth } = await fixture();
  const local = await auth.registerLocalUser({ email: 'linked@example.test', password: 'correct horse battery staple' });
  const google = await auth.findOrCreateGoogleUser({ providerUserId: 'google-linked', email: 'LINKED@example.test', name: 'Linked User' });
  assert.equal(google.id, local.id);
  assert.equal((await auth.authenticateLocalUser({ email: 'linked@example.test', password: 'correct horse battery staple' })).id, local.id);
  const googleAgain = await auth.findOrCreateGoogleUser({ providerUserId: 'google-linked', email: 'linked@example.test' });
  assert.equal(googleAgain.id, local.id);
});

test('a Google-only user can add a local password without creating a duplicate', async () => {
  const { auth } = await fixture();
  const google = await auth.findOrCreateGoogleUser({ providerUserId: 'google-password-link', email: 'google-only@example.test', name: 'Google User' });
  const linked = await auth.registerLocalUser({ email: 'GOOGLE-ONLY@example.test', password: 'correct horse battery staple' });
  assert.equal(linked.id, google.id);
  assert.equal((await auth.authenticateLocalUser({ email: 'google-only@example.test', password: 'correct horse battery staple' })).id, google.id);
});

test('two local users keep sessions isolated and logout revokes only the selected session', async () => {
  const { auth } = await fixture();
  const userA = await auth.registerLocalUser({ email: 'a@example.test', password: 'password-a-123' });
  const userB = await auth.registerLocalUser({ email: 'b@example.test', password: 'password-b-123' });
  const sessionA = await auth.createSession(userA.id); const sessionB = await auth.createSession(userB.id);
  assert.equal((await auth.getUserForSession(sessionA)).id, userA.id);
  assert.equal((await auth.getUserForSession(sessionB)).id, userB.id);
  await auth.revokeSession(sessionA);
  assert.equal(await auth.getUserForSession(sessionA), null);
  assert.equal((await auth.getUserForSession(sessionB)).id, userB.id);
});

test('authenticated User A cannot replace identity with a request-supplied User B', async () => {
  const { auth } = await fixture(); const user = await auth.findOrCreateGoogleUser({ providerUserId: 'google-a', email: 'a@example.test' }); const token = await auth.createSession(user.id);
  const req = request({ cookie: `project_session=${token}` }, { body: { userId: 'user-b' }, query: { userId: 'user-b' } }); const res = response();
  await createRequireAuthenticatedUser({ authService: auth })(req, res, () => {});
  assert.equal(req.user.id, user.id); assert.notEqual(req.user.id, 'user-b');
});

test('ownership remains bound to verified application user id', () => {
  const conversation = { id: 'conversation-a', ownerId: 'user-a' };
  const userA = request({}, { user: { id: 'user-a' }, body: { userId: 'user-b' }, query: { userId: 'user-b' } });
  const userB = request({}, { user: { id: 'user-b' }, body: { userId: 'user-a' }, query: { userId: 'user-a' } });
  assert.equal(getAuthenticatedOwnerId(userA), 'user-a'); assert.equal(ownsConversation(conversation, userA), true); assert.equal(ownsConversation(conversation, userB), false);
});

test('Google authorization uses state/nonce and verifies the provider audience', async () => {
  const authState = createGoogleState();
  const url = new URL(buildGoogleAuthorizationUrl({ clientId: 'client-id', callbackUrl: 'http://localhost/callback', ...authState }));
  assert.equal(url.searchParams.get('state'), authState.state); assert.equal(url.searchParams.get('nonce'), authState.nonce);
  const payload = { header: {}, nonce: authState.nonce };
  const idToken = `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
  const calls = [];
  const identity = await verifyGoogleIdentity({ tokenPayload: { id_token: idToken, access_token: 'google-access' }, clientId: 'client-id', expectedNonce: authState.nonce, fetchImpl: async (url, options) => {
    calls.push([url, options]);
    if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) return new Response(JSON.stringify({ aud: 'client-id', iss: 'https://accounts.google.com', sub: 'google-a', email_verified: 'true' }), { status: 200 });
    return new Response(JSON.stringify({ sub: 'google-a', email: 'a@example.test', name: 'A' }), { status: 200 });
  } });
  assert.equal(identity.providerUserId, 'google-a'); assert.equal(calls.length, 2);
});

import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { config } from './config.js';
import { publicModels, resolveModel } from './modelRegistry.js';
import { createMcpClients } from './mcpClient.js';
import { ToolRegistry } from './toolRegistry.js';
import { AgentService } from './agentService.js';
import { createRequireAuthenticatedUser, getSessionToken } from './auth.js';
import { ApplicationAuthService } from './applicationAuth.js';
import { getAuthenticatedOwnerId, ownsConversation } from './ownership.js';
import { IntegrationService } from './integrationService.js';
import { connectPlaneIntegration } from './planeLinking.js';
import { connectDiscordIntegration } from './discordLinking.js';
import { buildGoogleAuthorizationUrl, createGoogleState, exchangeGoogleCode, verifyGoogleIdentity } from './googleAuth.js';
import { OAuthStateStore } from './oauthState.js';
import { buildPlaneAuthorizationUrl, exchangePlaneCode, getPlaneProfile, isPlaneOAuthConfigured, refreshPlaneToken } from './planeOAuth.js';
import { buildDiscordAuthorizationUrl, exchangeDiscordCode, fetchDiscordInternal } from './discordOAuth.js';
import { createDatabase, initializeDatabase } from './database.js';
import { UserRepository, SessionRepository, IntegrationRepository, ConversationRepository } from './repositories.js';

const app = express();
const database = createDatabase({ connectionString: config.databaseUrl || undefined, host: config.databaseHost, port: config.databasePort, database: config.databaseName, user: config.databaseUser, password: config.databasePassword });
await initializeDatabase(database, await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
const userRepository = new UserRepository(database);
const sessionRepository = new SessionRepository(database);
const conversationRepository = new ConversationRepository(database);
const authService = new ApplicationAuthService({
  userRepository,
  sessionRepository,
  sessionTtlMs: config.authSessionTtlMs,
});
const requireAuthenticatedUser = createRequireAuthenticatedUser({ authService });
const googleStates = new Map();
const integrationOAuthStates = new OAuthStateStore({ ttlMs: config.oauthStateTtlMs });
const planeRefreshLocks = new Map();
const mcpClients = createMcpClients();
const integrations = new IntegrationService({
  integrationRepository: new IntegrationRepository(database),
  encryptionKey: config.integrationEncryptionKey,
});
const resolveExecutionContext = async (userId, tool) => {
  if (!userId) throw Object.assign(new Error('Authenticated user is required'), { code: 'PLANE_CONTEXT_INVALID' });
  const integration = await integrations.getIntegration(userId, tool.server);
  if (tool.server === 'plane') {
    if (!integration?.accessToken) throw Object.assign(new Error('Plane account is not connected for this user.'), { code: 'PLANE_NOT_CONNECTED', statusCode: 400 });
    let accessToken = integration.accessToken;
    if (integration.credentialType === 'oauth' && integration.expiresAt && new Date(integration.expiresAt).getTime() <= Date.now() + 60_000) {
      if (!integration.refreshToken || !isPlaneOAuthConfigured(config)) {
        throw Object.assign(new Error('Plane authorization expired; reconnect is required.'), { code: 'PLANE_RECONNECT_REQUIRED', statusCode: 400 });
      }
      const refresh = planeRefreshLocks.get(String(userId)) ?? (async () => {
        const refreshed = await refreshPlaneToken(integration.refreshToken, config);
        const refreshedAccessToken = refreshed.access_token;
        await integrations.saveIntegration(userId, 'plane', {
          accessToken: refreshedAccessToken,
          refreshToken: refreshed.refresh_token ?? integration.refreshToken,
          expiresAt: refreshed.expires_in ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString() : null,
          credentialType: 'oauth',
        });
        return refreshedAccessToken;
      })();
      planeRefreshLocks.set(String(userId), refresh);
      try { accessToken = await refresh; } finally { if (planeRefreshLocks.get(String(userId)) === refresh) planeRefreshLocks.delete(String(userId)); }
    }
    return { userId: String(userId), apiKey: accessToken, authType: integration.credentialType === 'oauth' ? 'oauth' : 'pat' };
  }
  if (tool.server === 'discord') {
    if (!integration?.guildId || !integration.channelId) throw Object.assign(new Error('Discord destination is not configured for this user.'), { code: 'DISCORD_NOT_CONNECTED', statusCode: 400 });
    return { userId: String(userId), guildId: integration.guildId, channelId: integration.channelId };
  }
  return { userId: String(userId) };
};
const agent = new AgentService(new ToolRegistry(mcpClients, resolveExecutionContext));
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => console.info(JSON.stringify({ event: 'api.request.completed', requestId: req.requestId, method: req.method, path: req.path, userId: req.user?.id ? String(req.user.id) : null, status: res.statusCode, durationMs: Date.now() - startedAt })));
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin is not allowed'));
    },
    credentials: true,
  }),
);

const upstreamAuthHeaders = (req) => {
  // LibreChat is used only as a model/UI integration. Never send the project
  // authentication cookie there as an identity signal.
  return {
    ...(config.libreChatServiceToken ? { authorization: `Bearer ${config.libreChatServiceToken}` } : {}),
  };
};

const describeError = (error, status) => {
  const message = String(error?.message || 'Unknown error');
  const known = {
    AUTH_REQUIRED: ['AUTH_REQUIRED', 'Authentication is required.'],
    AUTH_SESSION_EXPIRED: ['AUTH_SESSION_EXPIRED', 'Your session has expired. Please sign in again.'],
    AUTH_REFRESH_FAILED: ['AUTH_REFRESH_FAILED', 'Your session could not be refreshed. Please sign in again.'],
    PLANE_NOT_CONNECTED: ['PLANE_NOT_CONNECTED', 'Plane is not connected for this user.'],
    DISCORD_NOT_CONNECTED: ['DISCORD_NOT_CONNECTED', 'Discord destination is not configured for this user.'],
    PLANE_UNAUTHORIZED: ['PLANE_UNAUTHORIZED', 'Plane rejected the configured credential.'],
    PLANE_FORBIDDEN: ['PLANE_FORBIDDEN', 'Plane denied access to this account or resource.'],
    DISCORD_DESTINATION_FORBIDDEN: ['DISCORD_DESTINATION_FORBIDDEN', 'The Discord bot cannot access the selected destination.'],
    MCP_SERVER_UNREACHABLE: ['MCP_SERVER_UNREACHABLE', 'The requested MCP server is unavailable.'],
    MCP_SERVER_ERROR: ['MCP_SERVER_ERROR', 'The requested MCP server returned an error.'],
    DATABASE_ERROR: ['DATABASE_ERROR', 'The integration database is temporarily unavailable.'],
  };
  if (known[error?.code]) return { code: known[error.code][0], action: known[error.code][1] };
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND' || /postgres|database|pool/i.test(message)) return { code: 'DATABASE_ERROR', action: 'The integration database is temporarily unavailable.' };
  if (error?.code === 'PLANE_OAUTH_UNAVAILABLE') return { code: 'PLANE_OAUTH_UNAVAILABLE', action: 'Plane OAuth is not configured for this deployment. Use Advanced setup to connect with a Personal Access Token.' };
  if (error?.code === 'PLANE_CONFIGURATION_ERROR') return { code: 'PLANE_CONFIGURATION_ERROR', action: 'Check the configured Plane deployment URL and OAuth application settings.' };
  if (error?.code === 'PLANE_UPSTREAM_UNREACHABLE') return { code: 'PLANE_UPSTREAM_UNREACHABLE', action: 'The configured Plane service could not be reached. Check the backend network and Plane URL.' };
  if (error?.code === 'PLANE_RECONNECT_REQUIRED' || error?.code === 'PLANE_OAUTH_REFRESH_FAILED') return { code: 'PLANE_RECONNECT_REQUIRED', action: 'Plane authorization expired. Reconnect the Plane account in Settings.' };
  if (status === 429 || /quota|rate limit|too many requests/i.test(message)) {
    return {
      code: 'GEMINI_QUOTA_EXCEEDED',
      action: 'Kiểm tra quota/billing của Google AI Studio hoặc đổi GOOGLE_KEY; không retry liên tục.',
    };
  }
  if (status === 503 && /GOOGLE_KEY/i.test(message)) {
    return {
      code: 'GOOGLE_KEY_MISSING',
      action: 'Kiểm tra GOOGLE_KEY trong MCPServer/be/.env rồi khởi động lại backend.',
    };
  }
  if (status === 502 || /gemini|upstream|fetch failed|timeout/i.test(message)) {
    return {
      code: 'MODEL_UPSTREAM_ERROR',
      action: 'Kiểm tra trạng thái Gemini, model mapping và kết nối mạng; xem requestId trong log backend.',
    };
  }
  return { code: 'CHAT_BACKEND_ERROR', action: 'Xem log backend theo requestId để xác định nguyên nhân.' };
};

const jsonError = (res, error) => {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  const requestId = res.req?.requestId || crypto.randomUUID();
  const details = describeError(error, status);
  const diagnosticUrl = error?.diagnosticUrl || (res.req?.path?.startsWith('/api/integrations/plane') ? config.planeOAuthAuthorizeUrl || config.planeBaseUrl : '');
  let hostname = null;
  try { hostname = diagnosticUrl ? new URL(diagnosticUrl).hostname : null; } catch { hostname = null; }
  console.error(JSON.stringify({
    event: 'api.error', requestId, method: res.req?.method, path: res.req?.originalUrl,
    status, code: details.code, message: redactSensitiveText(error?.message || 'Unknown error'),
    operation: error?.operation || null, hostname, errorName: error?.name || 'Error', causeCode: error?.cause?.code || null,
    retryAfter: error?.retryAfter,
  }));
  if (status === 429 && Number.isFinite(error.retryAfter)) res.setHeader('Retry-After', String(error.retryAfter));
  return res.status(status).json({
    error: details.action,
    code: details.code,
    action: details.action,
    requestId,
  });
};

const redactSensitiveText = (value) => String(value ?? 'Unknown error')
  .replace(/(authorization|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  .replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[redacted]')
  .slice(0, 500);

const notFound = () => {
  const error = new Error('Conversation not found');
  error.statusCode = 404;
  return error;
};

const readHistory = async (ownerId) => Object.fromEntries((await conversationRepository.listByOwner(ownerId)).map((conversation) => [conversation.id, conversation]));
const writeHistory = async (history) => Promise.all(Object.values(history).map((conversation) => conversationRepository.upsert(conversation)));

const callGoogleModel = async (mapping, messages) => {
  if (!config.googleKey) {
    const error = new Error('GOOGLE_KEY is not configured on the backend');
    error.statusCode = 503;
    throw error;
  }
  const model = mapping.model || 'gemini-2.5-flash';
  const contents = messages.map((item) => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: item.text }],
  }));
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.googleKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents }),
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Model request failed (${response.status})`);
    error.statusCode = response.status >= 500 ? 502 : 400;
    throw error;
  }
  return payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
};

const copyUpstreamResponse = async (upstream, res) => {
  res.status(upstream.status);
  for (const [name, value] of upstream.headers) {
    if (name === 'set-cookie') continue;
    if (['connection', 'content-length', 'transfer-encoding'].includes(name)) continue;
    res.setHeader(name, value);
  }
  // Node's fetch exposes multiple upstream cookies through getSetCookie().
  // Preserve them individually so LibreChat's refresh/session cookies are not
  // collapsed into an invalid comma-joined cookie header.
  const setCookies = typeof upstream.headers.getSetCookie === 'function'
    ? upstream.headers.getSetCookie()
    : (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie')] : []);
  if (setCookies.length) res.setHeader('set-cookie', setCookies);
  if (upstream.body) {
    for await (const chunk of upstream.body) res.write(chunk);
  }
  return res.end();
};

const proxyGenerationRequest = async (req, res, path) => {
  const query = req.originalUrl.includes('?')
    ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
    : '';
  const upstream = await fetch(`${config.libreChatUrl}/api/agents/chat/${path}${query}`, {
    method: req.method,
    headers: {
      ...upstreamAuthHeaders(req),
      ...(req.get('content-type') ? { 'content-type': req.get('content-type') } : {}),
      ...(req.get('user-agent') ? { 'user-agent': req.get('user-agent') } : {}),
      accept: req.get('accept') ?? 'application/json, text/event-stream',
    },
    ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: JSON.stringify(req.body ?? {}) }),
  });
  return copyUpstreamResponse(upstream, res);
};

const authErrorRedirect = (res, code) => res.redirect(`${config.projectFrontendUrl}/?auth_error=${encodeURIComponent(code)}`);
const safeReturnTo = (value) => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/chat/new';
const serializeCookie = (name, value, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge / 1000))}`);
  return parts.join('; ');
};
const setSessionCookie = (res, token, options) => res.setHeader('Set-Cookie', serializeCookie('project_session', token, options));
const clearSessionCookie = (res, options) => res.setHeader('Set-Cookie', serializeCookie('project_session', '', { ...options, maxAge: 0 }));
const authRateLimits = new Map();
const allowAuthAttempt = (req, kind) => {
  const key = `${kind}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
  const now = Date.now(); const current = authRateLimits.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (current.resetAt <= now) { current.count = 0; current.resetAt = now + 15 * 60 * 1000; }
  current.count += 1; authRateLimits.set(key, current);
  return current.count <= 10;
};
const localAuthError = (res, error) => {
  if (error.code === 'AUTH_EMAIL_EXISTS' || error.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.', code: 'AUTH_EMAIL_EXISTS' });
  if (error.code === 'AUTH_INPUT_INVALID') return res.status(400).json({ error: 'Enter a valid email and password.', code: error.code });
  if (error.code === 'AUTH_INVALID_CREDENTIALS') return res.status(401).json({ error: 'Invalid email or password.', code: error.code });
  console.error(JSON.stringify({ event: 'auth.local.failed', requestId: res.req?.requestId, code: 'AUTH_LOCAL_FAILED' }));
  return res.status(500).json({ error: 'Authentication failed.', code: 'AUTH_LOCAL_FAILED' });
};

app.post('/api/auth/register', async (req, res) => {
  if (!allowAuthAttempt(req, 'register')) return res.status(429).json({ error: 'Too many authentication attempts. Try again later.', code: 'AUTH_RATE_LIMITED' });
  try {
    const user = await authService.registerLocalUser({ email: req.body?.email, password: req.body?.password, name: req.body?.displayName || req.body?.name });
    const sessionToken = await authService.createSession(user.id);
    setSessionCookie(res, sessionToken, authService.cookieOptions({ secure: config.authCookieSecure }));
    console.info(JSON.stringify({ event: 'auth.login.success', provider: 'password', userId: user.id, requestId: req.requestId }));
    return res.status(201).json({ authenticated: true, user });
  } catch (error) { return localAuthError(res, error); }
});

app.post('/api/auth/login', async (req, res) => {
  if (!allowAuthAttempt(req, 'login')) return res.status(429).json({ error: 'Too many authentication attempts. Try again later.', code: 'AUTH_RATE_LIMITED' });
  try {
    const user = await authService.authenticateLocalUser({ email: req.body?.email, password: req.body?.password });
    const sessionToken = await authService.createSession(user.id);
    setSessionCookie(res, sessionToken, authService.cookieOptions({ secure: config.authCookieSecure }));
    console.info(JSON.stringify({ event: 'auth.login.success', provider: 'password', userId: user.id, requestId: req.requestId }));
    return res.json({ authenticated: true, user });
  } catch (error) { return localAuthError(res, error); }
});

app.get('/api/auth/google', (req, res) => {
  const missing = [
    !config.googleClientId ? 'GOOGLE_CLIENT_ID' : null,
    !config.googleClientSecret ? 'GOOGLE_CLIENT_SECRET' : null,
  ].filter(Boolean);
  if (missing.length) {
    return res.status(503).json({
      error: 'Google OAuth configuration is incomplete',
      code: 'AUTH_CONFIG_MISSING',
      missing,
    });
  }
  const authState = createGoogleState();
  googleStates.set(authState.state, { nonce: authState.nonce, returnTo: safeReturnTo(req.query.returnTo), expiresAt: Date.now() + 10 * 60 * 1000 });
  return res.redirect(buildGoogleAuthorizationUrl({ clientId: config.googleClientId, callbackUrl: config.authCallbackUrl, ...authState }));
});

app.get('/api/auth/google/callback', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const pending = googleStates.get(state);
  googleStates.delete(state);
  if (!pending || pending.expiresAt <= Date.now()) return authErrorRedirect(res, 'AUTH_FAILED');
  if (typeof req.query.error === 'string' || typeof req.query.code !== 'string') return authErrorRedirect(res, 'AUTH_PROVIDER_ERROR');
  try {
    const tokenPayload = await exchangeGoogleCode({ code: req.query.code, clientId: config.googleClientId, clientSecret: config.googleClientSecret, callbackUrl: config.authCallbackUrl });
    const identity = await verifyGoogleIdentity({ tokenPayload, clientId: config.googleClientId, expectedNonce: pending.nonce });
    const user = await authService.findOrCreateGoogleUser(identity);
    const sessionToken = await authService.createSession(user.id);
    setSessionCookie(res, sessionToken, authService.cookieOptions({ secure: config.authCookieSecure }));
    console.info(JSON.stringify({ event: 'auth.login.success', provider: 'google', userId: user.id, requestId: req.requestId }));
    return res.redirect(`${config.projectFrontendUrl}${pending.returnTo || '/chat/new'}`);
  } catch (error) {
    console.error(JSON.stringify({ event: 'auth.login.failed', provider: 'google', code: error.code || 'AUTH_PROVIDER_ERROR', requestId: req.requestId }));
    return authErrorRedirect(res, error.code || 'AUTH_PROVIDER_ERROR');
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const user = await authService.getUserForSession(getSessionToken(req));
    if (!user) return res.status(401).json({ error: 'Session expired', code: 'AUTH_SESSION_EXPIRED' });
    return res.json({ authenticated: true, user });
  } catch (error) {
    console.error(JSON.stringify({ event: 'auth.refresh.failed', requestId: req.requestId, code: 'AUTH_REFRESH_FAILED' }));
    return res.status(401).json({ error: 'Session refresh failed', code: 'AUTH_REFRESH_FAILED' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  await authService.revokeSession(getSessionToken(req));
  clearSessionCookie(res, { httpOnly: true, secure: config.authCookieSecure, sameSite: 'lax', path: '/' });
  return res.json({ authenticated: false });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Identity is derived from the verified project session; request-supplied IDs
// are never accepted at this boundary.
app.get('/api/me', requireAuthenticatedUser, (req, res) => {
  res.json({ authenticated: true, user: {
    id: req.user.id, email: req.user.email, name: req.user.name, avatar: req.user.avatar,
  } });
});

app.get('/api/chat/models', (_req, res) => {
  res.json({ models: publicModels() });
});

// Expose only safe profile metadata from the verified project session.
app.get('/api/chat/profile', requireAuthenticatedUser, async (req, res) => {
  return res.json({ email: req.user.email || '', username: req.user.username || '' });
});

app.get('/api/chat/integrations', requireAuthenticatedUser, async (req, res) => {
  try {
    const providers = ['plane', 'discord'];
    const result = await Promise.all(providers.map((provider) => integrations.getSafeIntegration(getAuthenticatedOwnerId(req), provider)));
    return res.json({ integrations: result });
  } catch (error) {
    return jsonError(res, error);
  }
});

app.get('/api/integrations/plane', requireAuthenticatedUser, async (req, res) => {
  try {
    return res.json(await integrations.getSafeIntegration(getAuthenticatedOwnerId(req), 'plane'));
  } catch (error) {
    return jsonError(res, error);
  }
});

const isDevelopment = process.env.NODE_ENV !== 'production';

const startPlaneOAuth = (req, res) => {
  try {
    const state = integrationOAuthStates.create({ userId: req.user.id, provider: 'plane', returnTo: '/chat/new' });
    const authorizationUrl = buildPlaneAuthorizationUrl(config, state);
    if (isDevelopment) {
      const parsedAuthorizationUrl = new URL(authorizationUrl);
      console.info('[Plane OAuth] authorization request', {
        authorizeEndpoint: parsedAuthorizationUrl.origin + parsedAuthorizationUrl.pathname,
        client_id: parsedAuthorizationUrl.searchParams.get('client_id'),
        redirect_uri: parsedAuthorizationUrl.searchParams.get('redirect_uri'),
        configuredRedirectUri: config.planeOAuthRedirectUri,
        redirectUriMatchesConfigured: parsedAuthorizationUrl.searchParams.get('redirect_uri') === config.planeOAuthRedirectUri,
        scope: parsedAuthorizationUrl.searchParams.get('scope') || '',
        statePresent: Boolean(parsedAuthorizationUrl.searchParams.get('state')),
        authorizationUrl,
      });
    }
    return res.redirect(authorizationUrl);
  } catch (error) { error.operation = 'plane.oauth.start'; error.diagnosticUrl = config.planeOAuthAuthorizeUrl || config.planeBaseUrl; return jsonError(res, error); }
};

app.get('/api/integrations/plane/connect', requireAuthenticatedUser, startPlaneOAuth);
app.get('/api/integrations/plane/oauth/start', requireAuthenticatedUser, startPlaneOAuth);

const planeOAuthCallback = async (req, res) => {
  if (isDevelopment) {
    console.info('plane.oauth.callback.received', {
      method: req.method,
      path: req.path,
      hasCode: typeof req.query.code === 'string' && req.query.code.length > 0,
      hasState: typeof req.query.state === 'string' && req.query.state.length > 0,
      providerError: typeof req.query.error === 'string' ? req.query.error : null,
      providerErrorDescription: typeof req.query.error_description === 'string' ? req.query.error_description : null,
    });
  }
  const pending = integrationOAuthStates.consume(typeof req.query.state === 'string' ? req.query.state : '', 'plane');
  if (isDevelopment) console.info('plane.oauth.callback.state_validation', { valid: Boolean(pending) });
  if (!pending) return res.redirect(`${config.projectFrontendUrl}/chat/new?integration=plane&status=error&code=PLANE_OAUTH_STATE_INVALID`);
  if (typeof req.query.error === 'string' && req.query.error.length > 0) {
    const providerCode = req.query.error === 'access_denied' ? 'PLANE_OAUTH_DENIED' : 'PLANE_OAUTH_PROVIDER_ERROR';
    return res.redirect(`${config.projectFrontendUrl}${pending.returnTo}?integration=plane&status=error&code=${providerCode}`);
  }
  if (typeof req.query.code !== 'string' || req.query.code.length === 0) {
    return res.redirect(`${config.projectFrontendUrl}${pending.returnTo}?integration=plane&status=error&code=PLANE_OAUTH_CODE_MISSING`);
  }
  if (isDevelopment) console.info('plane.oauth.token_exchange.started');
  try {
    const token = await exchangePlaneCode(req.query.code, config);
    const profile = await getPlaneProfile(token.access_token, config);
    await integrations.saveIntegration(pending.userId, 'plane', {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null,
      externalUserId: String(profile.id),
      credentialType: 'oauth',
      workspaceId: profile.workspace_id ?? profile.workspace?.id ?? null,
      workspaceSlug: profile.workspace_slug ?? profile.workspace?.slug ?? null,
      metadata: { accountName: profile.display_name ?? profile.name ?? profile.email ?? null, workspaceName: profile.workspace?.name ?? profile.workspace_name ?? null, authType: 'oauth' },
    });
    if (isDevelopment) console.info(JSON.stringify({ event: 'integration.saved', provider: 'plane', userId: String(pending.userId), credentialType: 'oauth', hasWorkspace: Boolean(profile.workspace_id ?? profile.workspace?.id ?? profile.workspace_slug ?? profile.workspace?.slug) }));
    return res.redirect(`${config.projectFrontendUrl}${pending.returnTo}?integration=plane&status=connected`);
  } catch (error) { return res.redirect(`${config.projectFrontendUrl}${pending.returnTo}?integration=plane&status=error&code=${encodeURIComponent(error.code || 'PLANE_OAUTH_FAILED')}`); }
};

app.get('/api/integrations/plane/callback', planeOAuthCallback);
app.get('/api/integrations/plane/oauth/callback', planeOAuthCallback);

app.post('/api/integrations/plane/connect', requireAuthenticatedUser, async (req, res) => {
  try {
    const integration = await connectPlaneIntegration(getAuthenticatedOwnerId(req), req.body, {
      baseUrl: config.planeBaseUrl,
      timeoutMs: config.planeValidationTimeoutMs,
      saveIntegration: (userId, provider, credentials) => integrations.saveIntegration(userId, provider, credentials),
    });
    return res.status(201).json({ integration });
  } catch (error) {
    return jsonError(res, error);
  }
});

app.delete('/api/integrations/plane', requireAuthenticatedUser, async (req, res) => {
  try {
    await integrations.disconnectIntegration(getAuthenticatedOwnerId(req), 'plane');
    return res.status(204).end();
  } catch (error) {
    return jsonError(res, error);
  }
});

app.get('/api/integrations/discord', requireAuthenticatedUser, async (req, res) => {
  try {
    return res.json(await integrations.getSafeIntegration(getAuthenticatedOwnerId(req), 'discord'));
  } catch (error) {
    return jsonError(res, error);
  }
});

app.get('/api/integrations/discord/connect', requireAuthenticatedUser, (req, res) => {
  if (!config.discordClientId || !config.discordClientSecret || !config.discordOAuthRedirectUri) return jsonError(res, Object.assign(new Error('Discord OAuth is not configured'), { code: 'DISCORD_OAUTH_UNAVAILABLE', statusCode: 503 }));
  const state = integrationOAuthStates.create({ userId: req.user.id, provider: 'discord', returnTo: '/chat/new' });
  return res.redirect(buildDiscordAuthorizationUrl(config, state));
});

app.get('/api/integrations/discord/callback', async (req, res) => {
  const pending = integrationOAuthStates.consume(typeof req.query.state === 'string' ? req.query.state : '', 'discord');
  if (!pending) return res.redirect(`${config.projectFrontendUrl}/chat/new?integration=discord&status=error&code=DISCORD_OAUTH_STATE_INVALID`);
  if (req.query.error || typeof req.query.code !== 'string') return res.redirect(`${config.projectFrontendUrl}${pending.returnTo}?integration=discord&status=error&code=DISCORD_OAUTH_CANCELLED`);
  try {
    const token = await exchangeDiscordCode(req.query.code, config);
    const profile = await fetchDiscordInternal('/identity', { accessToken: token.access_token, config });
    await integrations.saveIntegration(pending.userId, 'discord', {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null,
      externalUserId: profile?.id ?? null,
      credentialType: 'oauth',
      metadata: { accountName: profile?.name ?? profile?.username ?? null, authType: 'oauth', authorized: true },
    });
    return res.redirect(`${config.projectFrontendUrl}${pending.returnTo}?integration=discord&status=connected`);
  } catch (error) { return res.redirect(`${config.projectFrontendUrl}${pending.returnTo}?integration=discord&status=error&code=${encodeURIComponent(error.code || 'DISCORD_OAUTH_FAILED')}`); }
});

app.get('/api/integrations/discord/guilds', requireAuthenticatedUser, async (req, res) => {
  try {
    const integration = await integrations.getIntegration(req.user.id, 'discord');
    if (!integration?.accessToken) return res.status(400).json({ error: 'Discord account is not connected', code: 'DISCORD_NOT_CONNECTED' });
    return res.json(await fetchDiscordInternal('/guilds', { accessToken: integration.accessToken, config }));
  } catch (error) { return jsonError(res, error); }
});

app.get('/api/integrations/discord/guilds/:guildId/channels', requireAuthenticatedUser, async (req, res) => {
  try {
    const integration = await integrations.getIntegration(req.user.id, 'discord');
    if (!integration?.accessToken) return res.status(400).json({ error: 'Discord account is not connected', code: 'DISCORD_NOT_CONNECTED' });
    if (!/^\d{17,20}$/.test(req.params.guildId)) return res.status(400).json({ error: 'Invalid Discord server' });
    return res.json(await fetchDiscordInternal(`/guilds/${encodeURIComponent(req.params.guildId)}/channels`, { accessToken: integration.accessToken, config }));
  } catch (error) { return jsonError(res, error); }
});

app.post('/api/integrations/discord/connect', requireAuthenticatedUser, async (req, res) => {
  try {
    const integration = await connectDiscordIntegration(getAuthenticatedOwnerId(req), req.body, {
      validationUrl: config.discordValidationUrl,
      internalToken: config.mcpInternalToken,
      saveIntegration: (userId, provider, credentials, options) => integrations.saveIntegration(userId, provider, credentials, options),
    });
    return res.status(201).json({ integration });
  } catch (error) {
    return jsonError(res, error);
  }
});

app.post('/api/integrations/discord/destination', requireAuthenticatedUser, async (req, res) => {
  try {
    const integration = await connectDiscordIntegration(req.user.id, req.body, {
      validationUrl: config.discordValidationUrl, internalToken: config.mcpInternalToken,
      saveIntegration: (userId, provider, credentials, options) => integrations.saveIntegration(userId, provider, credentials, options),
    });
    return res.status(200).json({ integration });
  } catch (error) { return jsonError(res, error); }
});

app.delete('/api/integrations/discord', requireAuthenticatedUser, async (req, res) => {
  try {
    await integrations.disconnectIntegration(getAuthenticatedOwnerId(req), 'discord');
    return res.status(204).end();
  } catch (error) {
    return jsonError(res, error);
  }
});

app.put('/api/chat/integrations/:provider', requireAuthenticatedUser, async (req, res) => {
  try {
    if (req.params.provider === 'plane') return res.status(400).json({ error: 'Use /api/integrations/plane/connect to validate Plane credentials' });
    if (req.params.provider === 'discord') return res.status(400).json({ error: 'Use /api/integrations/discord/connect to validate Discord destinations' });
    const integration = await integrations.saveIntegration(getAuthenticatedOwnerId(req), req.params.provider, req.body ?? {});
    return res.status(200).json({ integration });
  } catch (error) {
    return jsonError(res, error);
  }
});

app.delete('/api/chat/integrations/:provider', requireAuthenticatedUser, async (req, res) => {
  try {
    await integrations.disconnectIntegration(getAuthenticatedOwnerId(req), req.params.provider);
    return res.status(204).end();
  } catch (error) {
    return jsonError(res, error);
  }
});

// Safe, browser-facing MCP catalog. URLs and credentials stay server-side.
app.get('/api/chat/mcp', requireAuthenticatedUser, async (_req, res) => {
  // MCP availability is live state; do not serve a stale cached 304 result.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const servers = await Promise.all([...mcpClients.entries()].map(async ([name, client]) => {
    try {
      const tools = await client.listTools();
      return { name, status: 'connected', toolCount: tools.length, tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema })) };
    } catch (error) {
      const safe = describeError(error, 502);
      return { name, status: 'error', toolCount: 0, tools: [], error: safe.action, code: safe.code };
    }
  }));
  res.json({ servers });
});

app.post('/api/chat/mcp/:name/test', requireAuthenticatedUser, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const client = mcpClients.get(req.params.name);
  if (!client) return res.status(404).json({ error: 'MCP server is not configured' });
  try {
    const tools = await client.listTools();
    return res.json({ name: req.params.name, status: 'connected', toolCount: tools.length, tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema })) });
  } catch (error) {
    const safe = describeError(error, 502);
    return res.status(502).json({ name: req.params.name, status: 'error', error: safe.action, code: safe.code });
  }
});

app.get('/api/chat/history', requireAuthenticatedUser, async (_req, res) => {
  const ownerId = getAuthenticatedOwnerId(_req);
  const history = await readHistory(ownerId);
  const conversations = Object.values(history)
    .filter((conversation) => conversation.ownerId === ownerId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ ownerId: _ownerId, ...conversation }) => conversation);
  res.json({ conversations });
});

app.post('/api/chat/conversations', requireAuthenticatedUser, async (req, res) => {
  try {
    const ownerId = getAuthenticatedOwnerId(req);
    const history = await readHistory(ownerId);
    const id = crypto.randomUUID();
    const conversation = {
      id,
      ownerId,
      title: 'Cuộc trò chuyện mới',
      modelId: resolveModel(req.body?.modelId ?? config.defaultModelId).modelId,
      mcpServers: [],
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    history[id] = conversation;
    await writeHistory(history);
    const { ownerId: _ownerId, ...publicConversation } = conversation;
    return res.status(201).json({ conversationId: id, conversation: publicConversation });
  } catch (error) {
    return jsonError(res, error);
  }
});

app.patch('/api/chat/conversations/:conversationId', requireAuthenticatedUser, async (req, res) => {
  try {
    const ownerId = getAuthenticatedOwnerId(req);
    const history = await readHistory(ownerId);
    const conversation = history[req.params.conversationId];
    if (!ownsConversation(conversation, req)) return res.status(404).json({ error: 'Conversation not found' });
    if (Array.isArray(req.body?.mcpServers)) conversation.mcpServers = req.body.mcpServers;
    conversation.updatedAt = Date.now();
    await writeHistory(history);
    const { ownerId: _ownerId, ...publicConversation } = conversation;
    return res.json({ conversation: publicConversation });
  } catch (error) {
    return jsonError(res, error);
  }
});

app.get('/api/chat/conversations/:conversationId', requireAuthenticatedUser, async (req, res) => {
  const ownerId = getAuthenticatedOwnerId(req);
  const conversation = await conversationRepository.findById(req.params.conversationId);
  if (!ownsConversation(conversation, req)) return res.status(404).json({ error: 'Conversation not found' });
  const { ownerId: _ownerId, ...publicConversation } = conversation;
  res.json({ conversation: publicConversation });
});

app.delete('/api/chat/history/:conversationId', requireAuthenticatedUser, async (req, res) => {
  const ownerId = getAuthenticatedOwnerId(req);
  const conversation = await conversationRepository.findById(req.params.conversationId);
  if (!ownsConversation(conversation, req)) return res.status(404).json({ error: 'Conversation not found' });
  await conversationRepository.delete(req.params.conversationId, ownerId);
  res.status(204).end();
});

/**
 * The endpoint accepts the normal project contract and the existing LibreChat
 * agent payload. Keeping the latter shape lets us preserve SSE, attachments,
 * tool calls, resume, steering, and conversation metadata during migration.
 */
app.post('/api/chat', requireAuthenticatedUser, async (req, res) => {
  const abortController = new AbortController();
  const onRequestClose = () => { if (!res.writableEnded) abortController.abort(); };
  let sendEvent;
  // IncomingMessage.close can fire after the request body is consumed, while
  // the browser is still waiting for the SSE response. Only abort when the
  // response connection itself is closed by the client.
  res.once('close', onRequestClose);
  try {
    const body = req.body ?? {};
    const ownerId = getAuthenticatedOwnerId(req);
    const mapping = {
      ...resolveModel(body.modelId ?? body.model),
      mcpServers: Array.isArray(body.mcpServers) ? body.mcpServers : null,
    };
    const message = (typeof body.message === 'string' ? body.message : body.text ?? body.userMessage?.text ?? '').trim();
    if (!message) {
      const error = new Error('message is required');
      error.statusCode = 400;
      throw error;
    }
    const conversationId = body.conversationId || crypto.randomUUID();
    const history = await readHistory(ownerId);
    const existingConversation = history[conversationId];
    if (existingConversation && !ownsConversation(existingConversation, req)) throw notFound();
    const conversation = existingConversation ?? {
      id: conversationId,
      ownerId,
      title: message.slice(0, 80),
      modelId: mapping.modelId,
      mcpServers: mapping.mcpServers ?? [],
      messages: [],
      createdAt: Date.now(),
    };
    if (body.editMessageCreatedAt != null && existingConversation) {
      const editIndex = conversation.messages.findIndex((item) => item.role === 'user' && item.createdAt === body.editMessageCreatedAt);
      if (editIndex >= 0) conversation.messages = conversation.messages.slice(0, editIndex);
    }
    conversation.ownerId = ownerId;
    conversation.modelId = mapping.modelId;
    // Store the MCP scope with the conversation so reopening or refreshing
    // the page restores the exact tool selection used for this chat.
    conversation.mcpServers = mapping.mcpServers ?? conversation.mcpServers ?? [];
    // Persist the scope before calling Gemini. A provider/MCP failure should
    // not discard the user's selection for the next attempt.
    history[conversationId] = conversation;
    await writeHistory(history);
    conversation.messages.push({ role: 'user', text: message, createdAt: Date.now() });
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    res.flushHeaders?.();
    sendEvent = (payload) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`); };
    const result = await agent.run(conversation, mapping, abortController.signal, (delta) => sendEvent({ delta }), { userId: ownerId, requestId: req.requestId });
    conversation.messages.push({ role: 'assistant', text: result.text, createdAt: Date.now() });
    conversation.updatedAt = Date.now();
    history[conversationId] = conversation;
    await writeHistory(history);
    sendEvent({ conversationId, modelId: mapping.modelId, text: result.text, usage: result.usage, conversation });
    sendEvent('[DONE]');
    return res.end();

    /* Legacy LibreChat payload kept below for reference during migration. */
    const isLibreChatPayload = typeof body.text === 'string' || body.userMessage;

    const payload = isLibreChatPayload
      ? {
          ...body,
          endpoint: 'agents',
          agent_id: mapping.agentId,
          modelId: mapping.modelId,
          // `modelId` is the project alias; LibreChat needs the trusted
          // provider model when it builds the agent endpoint option.
          model: mapping.model,
        }
      : {
          text: body.message,
          endpoint: 'agents',
          agent_id: mapping.agentId,
          modelId: mapping.modelId,
          model: mapping.model,
          conversationId: body.conversationId ?? null,
        };

    if (typeof payload.text !== 'string' && !payload.userMessage) {
      const error = new Error('message is required');
      error.statusCode = 400;
      throw error;
    }

    const upstream = await fetch(`${config.libreChatUrl}/api/agents/chat`, {
      method: 'POST',
      headers: {
        ...upstreamAuthHeaders(req),
        'content-type': 'application/json',
        ...(req.get('user-agent') ? { 'user-agent': req.get('user-agent') } : {}),
        accept: req.get('accept') ?? 'text/event-stream',
      },
      body: JSON.stringify(payload),
    });

    return copyUpstreamResponse(upstream, res);
  } catch (error) {
    if (error.name === 'AbortError' || abortController.signal.aborted) return;
    if (res.headersSent) {
      const safe = describeError(error, error.statusCode);
      sendEvent?.({ error: safe.action, code: safe.code, action: safe.action });
      sendEvent?.('[DONE]');
      return res.end();
    }
    return jsonError(res, error);
  }
});

// Keep lifecycle operations behind the same project-owned boundary. The
// browser must not know LibreChat's internal generation routes.
app.all('/api/chat/:path(*)', requireAuthenticatedUser, async (req, res) => {
  try {
    return await proxyGenerationRequest(req, res, req.params.path);
  } catch (error) {
    if (res.headersSent) return res.end();
    return jsonError(res, error);
  }
});

// Do not expose LibreChat's provider/agent routes or user-key APIs through
// the project browser boundary. The only model operation the UI may perform
// is POST /api/chat, with modelId resolved by the server-side allowlist.
app.all(['/api/agents/chat', '/api/agents/chat/:path(*)'], (_req, res) => {
  res.status(403).json({ error: 'Use the project chat endpoint' });
});
app.all(['/api/keys', '/api/keys/:path(*)', '/api/api-keys', '/api/api-keys/:path(*)'], (_req, res) => {
  res.status(403).json({ error: 'API key settings are managed by the project administrator' });
});

// Proxy the remaining LibreChat-compatible UI APIs through this BE. This keeps
// the existing LibreChat interface working while keeping LibreChat off the
// browser network boundary.
app.all('/api/:path(*)', requireAuthenticatedUser, async (req, res) => {
  try {
    const query = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : '';
    const upstream = await fetch(`${config.libreChatUrl}/api/${req.params.path}${query}`, {
      method: req.method,
      headers: {
        ...upstreamAuthHeaders(req),
        ...(req.get('content-type') ? { 'content-type': req.get('content-type') } : {}),
        ...(req.get('user-agent') ? { 'user-agent': req.get('user-agent') } : {}),
        accept: req.get('accept') ?? 'application/json, text/event-stream',
      },
      ...(req.method === 'GET' || req.method === 'HEAD'
        ? {}
        : { body: JSON.stringify(req.body ?? {}) }),
    });
    return copyUpstreamResponse(upstream, res);
  } catch (error) {
    if (res.headersSent) return res.end();
    return jsonError(res, error);
  }
});

app.use((error, _req, res, _next) => jsonError(res, error));

const server = app.listen(config.port, config.host, () => {
  console.log(`Chat backend listening on http://${config.host}:${config.port}`);
  console.log(`Forwarding chat requests to ${config.libreChatUrl}`);
});

const shutdown = async (signal) => {
  console.log(JSON.stringify({ event: 'server.shutdown', signal }));
  server.close(async () => { await database.close(); process.exit(0); });
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

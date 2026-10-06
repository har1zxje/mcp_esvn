export class PlaneOAuthError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

// Keep this list in code as well as .env.example.  Deployments that still have
// an older PLANE_OAUTH_SCOPES value get the required scopes appended to the
// authorization request instead of silently issuing an under-scoped token.
export const REQUIRED_PLANE_OAUTH_SCOPES = [
  'profile:read',
  'projects:read',
  'projects.work_items:read',
  'projects.work_items:write',
  // State lookup is required for dynamic state-ID resolution. Project-member
  // discovery is optional and must be explicitly enabled only after this
  // staged authorize request succeeds.
  'projects.states:read',
];

export function requiredPlaneOAuthScopes(configuredScopes = '') {
  const configured = typeof configuredScopes === 'string' ? configuredScopes.split(/\s+/).filter(Boolean) : [];
  return [...new Set([...configured, ...REQUIRED_PLANE_OAUTH_SCOPES])].join(' ');
}

export function isPlaneOAuthConfigured(config) {
  return Boolean(config.planeOAuthAuthorizeUrl && config.planeOAuthTokenUrl && config.planeClientId && config.planeClientSecret && config.planeOAuthRedirectUri);
}

export function buildPlaneAuthorizationUrl(config, state) {
  if (!isPlaneOAuthConfigured(config)) throw new PlaneOAuthError('PLANE_OAUTH_UNAVAILABLE', 'Plane OAuth is not configured for this deployment', 503);
  const url = new URL(config.planeOAuthAuthorizeUrl);
  url.search = new URLSearchParams({ response_type: 'code', client_id: config.planeClientId, redirect_uri: config.planeOAuthRedirectUri, state, scope: requiredPlaneOAuthScopes(config.planeOAuthScopes) }).toString();
  return url.toString();
}

function networkError(error, operation, url) {
  const wrapped = new PlaneOAuthError('PLANE_UPSTREAM_UNREACHABLE', 'Plane authorization service could not be reached', 503);
  wrapped.operation = operation;
  try { wrapped.diagnosticUrl = new URL(url).toString(); } catch { wrapped.diagnosticUrl = ''; }
  wrapped.cause = error;
  return wrapped;
}

export async function exchangePlaneCode(code, config, { fetchImpl = fetch } = {}) {
  if (!code) throw new PlaneOAuthError('PLANE_OAUTH_CODE_MISSING', 'Plane authorization was not completed');
  let response;
  try {
    response = await fetchImpl(config.planeOAuthTokenUrl, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: config.planeClientId, client_secret: config.planeClientSecret, redirect_uri: config.planeOAuthRedirectUri }) });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error(JSON.stringify({ event: 'token_exchange.failed', provider: 'plane', reason: 'network', errorName: error?.name || 'Error' }));
    throw networkError(error, 'plane.oauth.token_exchange', config.planeOAuthTokenUrl);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string') {
    if (process.env.NODE_ENV !== 'production') console.error(JSON.stringify({ event: 'token_exchange.failed', provider: 'plane', httpStatus: response.status, providerError: typeof payload.error === 'string' ? payload.error : null, providerErrorDescription: typeof payload.error_description === 'string' ? payload.error_description.slice(0, 300) : null, hasAccessToken: false, hasRefreshToken: typeof payload.refresh_token === 'string' }));
    throw new PlaneOAuthError('PLANE_OAUTH_FAILED', 'Plane authorization could not be completed', response.status >= 500 ? 503 : 400);
  }
  if (process.env.NODE_ENV !== 'production') console.info(JSON.stringify({ event: 'token_exchange.success', provider: 'plane', httpStatus: response.status, hasAccessToken: true, hasRefreshToken: typeof payload.refresh_token === 'string', expiresInPresent: payload.expires_in !== undefined }));
  return payload;
}

export async function refreshPlaneToken(refreshToken, config, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(config.planeOAuthTokenUrl, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: config.planeClientId, client_secret: config.planeClientSecret }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string') throw new PlaneOAuthError('PLANE_OAUTH_REFRESH_FAILED', 'Plane authorization expired; reconnect is required', 400);
  return payload;
}

export async function getPlaneProfile(accessToken, config, { fetchImpl = fetch, authType = 'oauth' } = {}) {
  const url = new URL('/api/v1/users/me/', config.planeBaseUrl);
  let response;
  try {
    const headers = { accept: 'application/json' };
    if (authType === 'oauth') headers.authorization = `Bearer ${accessToken}`;
    else headers['x-api-key'] = accessToken;
    response = await fetchImpl(url, { headers });
  } catch (error) {
    throw networkError(error, 'plane.oauth.profile', url);
  }
  const profile = await response.json().catch(() => ({}));
  if (response.status === 401) throw new PlaneOAuthError('PLANE_REAUTH_REQUIRED', 'Plane authorization is invalid or expired; reconnect is required.', 401);
  if (response.status === 403) throw new PlaneOAuthError('PLANE_FORBIDDEN', 'Plane authorization is valid but does not have permission to read the profile.', 403);
  if (!response.ok || !profile?.id) throw new PlaneOAuthError('PLANE_OAUTH_PROFILE_FAILED', 'Plane account could not be verified', response.status >= 500 ? 503 : 400);
  return profile;
}


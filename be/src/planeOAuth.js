export class PlaneOAuthError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

export function isPlaneOAuthConfigured(config) {
  return Boolean(config.planeOAuthAuthorizeUrl && config.planeOAuthTokenUrl && config.planeClientId && config.planeClientSecret && config.planeOAuthRedirectUri);
}

export function buildPlaneAuthorizationUrl(config, state) {
  if (!isPlaneOAuthConfigured(config)) throw new PlaneOAuthError('PLANE_OAUTH_UNAVAILABLE', 'Plane OAuth is not configured for this deployment', 503);
  const url = new URL(config.planeOAuthAuthorizeUrl);
  url.search = new URLSearchParams({ response_type: 'code', client_id: config.planeClientId, redirect_uri: config.planeOAuthRedirectUri, state, ...(config.planeOAuthScopes ? { scope: config.planeOAuthScopes } : {}) }).toString();
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

export async function getPlaneProfile(accessToken, config, { fetchImpl = fetch } = {}) {
  const url = new URL('/api/v1/users/me/', config.planeBaseUrl);
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
  const profile = await response.json().catch(() => ({}));
  if (!response.ok || !profile?.id) throw new PlaneOAuthError('PLANE_OAUTH_PROFILE_FAILED', 'Plane account could not be verified', 400);
  return profile;
}


export class PlaneCredentialError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message);
    this.name = 'PlaneCredentialError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function endpoint(baseUrl) {
  try {
    const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      throw new Error('Plane base URL must use HTTPS');
    }
    url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v1/users/me/`;
    url.search = '';
    return url;
  } catch {
    throw new PlaneCredentialError('PLANE_CONFIGURATION_ERROR', 'Plane integration is not configured safely', 503);
  }
}

export async function validatePlaneCredential(token, { baseUrl, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new PlaneCredentialError('PLANE_CREDENTIAL_REQUIRED', 'Plane credential is required', 400);
  }
  const url = endpoint(baseUrl);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'X-API-Key': token.trim(), accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new PlaneCredentialError('PLANE_UNAVAILABLE', 'Plane validation timed out', 503);
    }
    throw new PlaneCredentialError('PLANE_UNAVAILABLE', 'Plane validation is unavailable', 503);
  }

  if (response.status === 401) throw new PlaneCredentialError('PLANE_UNAUTHORIZED', 'Plane credential was rejected', 400);
  if (response.status === 403) throw new PlaneCredentialError('PLANE_FORBIDDEN', 'Plane credential cannot access this account', 403);
  if (!response.ok) {
    throw new PlaneCredentialError(response.status >= 500 ? 'PLANE_UNAVAILABLE' : 'PLANE_VALIDATION_FAILED', 'Plane credential validation failed', response.status >= 500 ? 503 : 400);
  }

  let profile;
  try {
    profile = await response.json();
  } catch {
    throw new PlaneCredentialError('PLANE_INVALID_RESPONSE', 'Plane returned an invalid validation response', 502);
  }
  const externalUserId = profile?.id ?? profile?.user?.id;
  if (!externalUserId || typeof externalUserId !== 'string') {
    throw new PlaneCredentialError('PLANE_INVALID_RESPONSE', 'Plane returned no authenticated user identity', 502);
  }
  return {
    valid: true,
    externalUserId,
    workspaceId: null,
    workspaceName: null,
  };
}

export async function connectPlaneIntegration(userId, body, { validate = validatePlaneCredential, saveIntegration, baseUrl, timeoutMs } = {}) {
  const token = body?.token ?? body?.accessToken;
  const validation = await validate(token, { baseUrl, timeoutMs });
  return saveIntegration(userId, 'plane', {
    accessToken: token.trim(),
    credentialType: 'pat',
    externalUserId: validation.externalUserId,
    workspaceId: validation.workspaceId,
    metadata: { authType: 'pat', ...(validation.workspaceName ? { workspaceName: validation.workspaceName } : {}) },
  });
}

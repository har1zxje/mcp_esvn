import crypto from 'node:crypto';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export function createGoogleState() {
  return { state: crypto.randomBytes(32).toString('base64url'), nonce: crypto.randomBytes(32).toString('base64url') };
}

export function buildGoogleAuthorizationUrl({ clientId, callbackUrl, state, nonce }) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: callbackUrl, response_type: 'code', scope: 'openid email profile', state, nonce, prompt: 'select_account' }).toString();
  return url.toString();
}

async function formPost(url, values, fetchImpl = fetch) {
  const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('Google token exchange failed'), { code: 'AUTH_PROVIDER_ERROR' });
  return payload;
}

export async function exchangeGoogleCode({ code, clientId, clientSecret, callbackUrl, fetchImpl = fetch }) {
  return formPost(GOOGLE_TOKEN_URL, { code, client_id: clientId, client_secret: clientSecret, redirect_uri: callbackUrl, grant_type: 'authorization_code' }, fetchImpl);
}

export async function verifyGoogleIdentity({ tokenPayload, clientId, expectedNonce, fetchImpl = fetch }) {
  if (!tokenPayload?.id_token || !tokenPayload.access_token) throw Object.assign(new Error('Google identity response is incomplete'), { code: 'AUTH_PROVIDER_ERROR' });
  const tokenInfoResponse = await fetchImpl(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(tokenPayload.id_token)}`);
  const claims = await tokenInfoResponse.json().catch(() => null);
  if (!tokenInfoResponse.ok || claims?.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims?.iss) || !claims?.sub || claims?.email_verified !== 'true') {
    throw Object.assign(new Error('Google identity verification failed'), { code: 'AUTH_PROVIDER_ERROR' });
  }
  let idTokenClaims = {};
  try { idTokenClaims = JSON.parse(Buffer.from(tokenPayload.id_token.split('.')[1], 'base64url').toString('utf8')); } catch { throw Object.assign(new Error('Google identity verification failed'), { code: 'AUTH_PROVIDER_ERROR' }); }
  if (expectedNonce && idTokenClaims.nonce !== expectedNonce) throw Object.assign(new Error('Google state verification failed'), { code: 'AUTH_FAILED' });
  const userResponse = await fetchImpl(GOOGLE_USERINFO_URL, { headers: { authorization: `Bearer ${tokenPayload.access_token}` } });
  const profile = await userResponse.json().catch(() => null);
  if (!userResponse.ok || profile?.sub !== claims.sub || !profile?.email) throw Object.assign(new Error('Google profile verification failed'), { code: 'AUTH_PROVIDER_ERROR' });
  return { providerUserId: claims.sub, email: profile.email, name: profile.name || profile.email, avatar: profile.picture || null };
}

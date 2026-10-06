import crypto from 'node:crypto';

const DEFAULT_SAFETY_WINDOW_MS = 60_000;

export class PlaneCredentialError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function credentialFingerprint(credential) {
  return credential ? crypto.createHash('sha256').update(String(credential)).digest('hex').slice(0, 8) : null;
}

/**
 * Resolves exactly one authenticated application's Plane credential. OAuth
 * refreshes are keyed by application user, so an expired credential can never
 * cause a lookup or fallback to another user's integration.
 */
export class PlaneCredentialService {
  constructor({ integrations, config, refreshToken, now = () => Date.now(), safetyWindowMs = DEFAULT_SAFETY_WINDOW_MS, logger = console } = {}) {
    if (!integrations || !config || !refreshToken) throw new Error('PlaneCredentialService requires integrations, config, and refreshToken.');
    this.integrations = integrations;
    this.config = config;
    this.refreshToken = refreshToken;
    this.now = now;
    this.safetyWindowMs = safetyWindowMs;
    this.logger = logger;
    this.refreshLocks = new Map();
  }

  async resolve(userId, { operation = 'plane.request', workspaceSlug, projectId } = {}) {
    const ownerId = String(userId || '').trim();
    if (!ownerId) throw new PlaneCredentialError('PLANE_CONTEXT_INVALID', 'Authenticated Plane execution context is missing.');
    let integration = await this.integrations.getIntegration(ownerId, 'plane');
    if (!integration?.accessToken) throw new PlaneCredentialError('PLANE_NOT_CONNECTED', 'Plane account is not connected for this user.');

    if (this.needsRefresh(integration)) {
      integration = await this.refresh(ownerId, integration);
    }

    const credential = integration.accessToken;
    const expiresAt = integration.expiresAt ?? null;
    const tokenExpired = expiresAt ? new Date(expiresAt).getTime() <= this.now() : false;
    this.logger.info?.(JSON.stringify({
      event: 'plane.credential.resolved', userId: ownerId,
      authType: integration.credentialType === 'oauth' ? 'oauth' : 'pat',
      hasAccessToken: Boolean(credential), hasRefreshToken: Boolean(integration.refreshToken),
      expiresAt, tokenExpired, credentialFingerprint: credentialFingerprint(credential),
      workspaceSlug: workspaceSlug ?? integration.workspaceSlug ?? null, operation,
      ...(projectId ? { projectId } : {}),
    }));
    return { integration, credential, authType: integration.credentialType === 'oauth' ? 'oauth' : 'pat' };
  }

  needsRefresh(integration) {
    if (integration.credentialType !== 'oauth' || !integration.expiresAt) return false;
    const expiresAt = new Date(integration.expiresAt).getTime();
    return !Number.isFinite(expiresAt) || expiresAt <= this.now() + this.safetyWindowMs;
  }

  async refresh(userId, integration) {
    if (!integration.refreshToken || !this.config.planeOAuthTokenUrl || !this.config.planeClientId || !this.config.planeClientSecret) {
      throw new PlaneCredentialError('PLANE_REAUTH_REQUIRED', 'Plane authorization is invalid or expired; reconnect is required.');
    }
    const existing = this.refreshLocks.get(userId);
    if (existing) return existing;
    const refresh = (async () => {
      try {
        const refreshed = await this.refreshToken(integration.refreshToken, this.config);
        await this.integrations.saveIntegration(userId, 'plane', {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? integration.refreshToken,
          expiresAt: refreshed.expires_in ? new Date(this.now() + Number(refreshed.expires_in) * 1000).toISOString() : null,
          credentialType: 'oauth',
        });
        const updated = await this.integrations.getIntegration(userId, 'plane');
        if (!updated?.accessToken) throw new Error('Refresh result could not be persisted for the authenticated user.');
        this.logger.info?.(JSON.stringify({ event: 'plane.credential.refreshed', userId, credentialFingerprint: credentialFingerprint(updated.accessToken) }));
        return updated;
      } catch (error) {
        this.logger.warn?.(JSON.stringify({ event: 'plane.credential.refresh_failed', userId, errorCode: error?.code ?? 'PLANE_OAUTH_REFRESH_FAILED' }));
        throw new PlaneCredentialError('PLANE_REAUTH_REQUIRED', 'Plane authorization is invalid or expired; reconnect is required.');
      }
    })();
    this.refreshLocks.set(userId, refresh);
    try { return await refresh; } finally { if (this.refreshLocks.get(userId) === refresh) this.refreshLocks.delete(userId); }
  }
}

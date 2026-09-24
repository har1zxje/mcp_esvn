/**
 * Project UI policy.
 *
 * Keep provider credentials, endpoint parameters and presets server-managed.
 * This is a presentation guard only; the backend must remain the authority.
 */
export const PROJECT_USER_MODE = true;

// Project authentication is independent from the LibreChat model integration.
export const PROJECT_GUEST_MODE = false;

export const PROJECT_NAME = 'eschat';

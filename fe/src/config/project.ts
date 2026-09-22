/**
 * Project UI policy.
 *
 * Keep provider credentials, endpoint parameters and presets server-managed.
 * This is a presentation guard only; the backend must remain the authority.
 */
export const PROJECT_USER_MODE = true;

// LibreChat's Agents API requires an authenticated user JWT. Keep the
// provider/API settings project-managed, but use the normal login flow so the
// project backend can forward a valid session to LibreChat.
export const PROJECT_GUEST_MODE = false;

export const PROJECT_NAME = 'eschat';

function readCookie(req, name) {
  const raw = req.get('cookie') || '';
  const match = raw.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

export function createRequireAuthenticatedUser({ authService, cookieName = 'project_session' }) {
  return async function requireAuthenticatedUser(req, res, next) {
    try {
      const user = await authService.getUserForSession(readCookie(req, cookieName));
      if (!user) return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
      req.user = user;
      return next();
    } catch (error) {
      console.error(JSON.stringify({ event: 'auth.verify.failed', requestId: req.requestId, code: 'AUTH_FAILED' }));
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_FAILED' });
    }
  };
}

export function getSessionToken(req, cookieName = 'project_session') {
  const raw = req.get('cookie') || '';
  const match = raw.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${cookieName}=`));
  return match ? decodeURIComponent(match.slice(cookieName.length + 1)) : '';
}

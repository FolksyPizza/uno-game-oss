// Shared session-cookie helpers for the Rosemont Games platform.
//
// Sessions are DB-backed (see core/db/users.js createSession/findUserBySession),
// so any service sharing the Postgres instance can validate any cookie. To make
// sign-in work across every *.rosemont.place subdomain (SSO), the cookie is
// scoped to COOKIE_DOMAIN (e.g. ".rosemont.place"). On localhost we leave the
// domain unset so the cookie stays host-only for dev.

const COOKIE_NAME = 'rg_sid';

function cookieDomain() {
  const d = process.env.COOKIE_DOMAIN;
  return d && d.trim() ? d.trim() : undefined; // undefined → host-only cookie
}

function isSecure() {
  const pub = (process.env.PUBLIC_URL || '').toLowerCase();
  return pub.startsWith('https://');
}

function setSessionCookie(res, sid) {
  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(),
    domain: cookieDomain(),
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { domain: cookieDomain(), path: '/' });
}

function readSidFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

module.exports = {
  COOKIE_NAME,
  cookieDomain,
  isSecure,
  setSessionCookie,
  clearSessionCookie,
  readSidFromCookieHeader,
};

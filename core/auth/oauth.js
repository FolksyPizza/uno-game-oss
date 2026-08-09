// Hand-rolled OAuth2 (Google + GitHub). No passport.
//
// Flow per provider:
//   GET /auth/<provider>          → redirect to provider with random `state` cookie
//   GET /auth/<provider>/callback → exchange code for token, fetch profile, upsert
//                                    user, create session, set sid cookie, redirect /
//
// If client credentials for a provider are missing, its routes are not registered
// and /auth/providers reflects that.

const crypto = require('node:crypto');
const users = require('../db/users');
const db = require('../db');
const session = require('../session');
const audit = require('../audit');

const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    parseProfile: (p) => ({
      providerId: p.sub,
      displayName: p.name || (p.email ? p.email.split('@')[0] : 'Player'),
      email: p.email,
      avatarUrl: p.picture,
    }),
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    profileUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
    clientId: () => process.env.GITHUB_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET,
    parseProfile: (p) => ({
      providerId: String(p.id),
      displayName: p.name || p.login || 'Player',
      email: p.email,
      avatarUrl: p.avatar_url,
    }),
  },
};

const SESSION_COOKIE = session.COOKIE_NAME;
const STATE_COOKIE = 'rg_oauth_state';
const RETURN_COOKIE = 'rg_oauth_return';

function publicUrl() {
  return (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 5050}`).replace(/\/$/, '');
}

function callbackUrl(provider) {
  return `${publicUrl()}/auth/${provider}/callback`;
}

function isConfigured(provider) {
  const p = PROVIDERS[provider];
  return !!(p && p.clientId() && p.clientSecret());
}

// Only allow post-login redirects back to our own properties (SSO across
// *.rosemont.place) or to localhost in dev. Anything else falls back to "/".
function safeReturnUrl(raw) {
  if (!raw || typeof raw !== 'string') return '/';
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const ok = host === 'localhost' || host === '127.0.0.1'
      || host === 'rosemont.place' || host.endsWith('.rosemont.place');
    if (ok) return u.toString();
  } catch {}
  return '/';
}

const setSessionCookie = (res, sid) => session.setSessionCookie(res, sid);
const clearSessionCookie = (res) => session.clearSessionCookie(res);
const readSidFromCookieHeader = (h) => session.readSidFromCookieHeader(h);

function register(app, cookieParser) {
  app.use(cookieParser());

  app.get('/auth/providers', (req, res) => {
    res.json({
      google: isConfigured('google'),
      github: isConfigured('github'),
    });
  });

  app.get('/auth/me', async (req, res) => {
    if (!db.isReady()) return res.json({ user: null });
    const sid = req.cookies?.[SESSION_COOKIE];
    if (!sid) return res.json({ user: null });
    try {
      const user = await users.findUserBySession(sid);
      if (!user) { clearSessionCookie(res); return res.json({ user: null }); }
      const isGuest = !!user.is_guest;
      // Guests accrue no stats.
      const stats = isGuest
        ? { wins: 0, games: 0, losses: 0 }
        : await users.getStats(user.id).catch(() => ({ wins: 0, games: 0, losses: 0 }));
      res.json({
        user: {
          id: user.id,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          provider: user.provider,
          isGuest,
          isAdmin: !!user.is_admin,
          showAdminBadge: user.show_admin_badge !== false,
          stats,
        },
      });
    } catch (e) {
      console.error('[AUTH] /auth/me error:', e.message);
      res.json({ user: null });
    }
  });

  // Guest sign-in: no OAuth, no credentials. Creates a "Guest ####" identity +
  // session so anyone can play immediately. Always available (even in degraded
  // mode we simply can't persist, so it requires the DB).
  app.post('/auth/guest', async (req, res) => {
    if (!db.isReady()) return res.status(503).json({ error: 'Guest mode temporarily unavailable' });
    // If already signed in, don't spawn a duplicate identity.
    const existingSid = req.cookies?.[SESSION_COOKIE];
    if (existingSid) {
      const cur = await users.findUserBySession(existingSid).catch(() => null);
      if (cur) return res.json({ user: { id: cur.id, displayName: cur.display_name, isGuest: !!cur.is_guest } });
    }
    try {
      const guest = await users.createGuest();
      const sid = await users.createSession(guest.id, 7); // guests: shorter TTL
      setSessionCookie(res, sid);
      audit.log('auth.guest', { actorUserId: guest.id, actorName: guest.display_name, req });
      res.json({ user: { id: guest.id, displayName: guest.display_name, isGuest: true } });
    } catch (e) {
      console.error('[AUTH] guest create error:', e.message);
      res.status(500).json({ error: 'Could not start guest session' });
    }
  });

  app.post('/auth/logout', async (req, res) => {
    const sid = req.cookies?.[SESSION_COOKIE];
    if (sid && db.isReady()) {
      const who = await users.findUserBySession(sid).catch(() => null);
      try { await users.destroySession(sid); } catch {}
      if (who) audit.log('auth.logout', { actorUserId: who.id, actorName: who.display_name, req });
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  for (const name of Object.keys(PROVIDERS)) {
    if (!isConfigured(name)) continue;
    const cfg = PROVIDERS[name];

    app.get(`/auth/${name}`, (req, res) => {
      const state = crypto.randomBytes(16).toString('hex');
      res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', maxAge: 5 * 60 * 1000, path: '/' });
      // Remember where to send the user after login (SSO across subdomains).
      const ret = safeReturnUrl(req.query.return);
      res.cookie(RETURN_COOKIE, ret, { httpOnly: true, sameSite: 'lax', maxAge: 5 * 60 * 1000, path: '/' });
      const url = new URL(cfg.authUrl);
      url.searchParams.set('client_id', cfg.clientId());
      url.searchParams.set('redirect_uri', callbackUrl(name));
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', cfg.scope);
      url.searchParams.set('state', state);
      res.redirect(url.toString());
    });

    app.get(`/auth/${name}/callback`, async (req, res) => {
      try {
        const { code, state } = req.query;
        const expected = req.cookies?.[STATE_COOKIE];
        res.clearCookie(STATE_COOKIE, { path: '/' });
        if (!code || !state || !expected || state !== expected) {
          return res.status(400).send('OAuth state mismatch');
        }
        if (!db.isReady()) return res.status(503).send('Auth temporarily unavailable');

        const tokenRes = await fetch(cfg.tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'application/json' },
          body: new URLSearchParams({
            client_id: cfg.clientId(),
            client_secret: cfg.clientSecret(),
            code,
            grant_type: 'authorization_code',
            redirect_uri: callbackUrl(name),
          }),
        });
        if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}`);
        const tokenJson = await tokenRes.json();
        const accessToken = tokenJson.access_token;
        if (!accessToken) throw new Error('no access_token in response');

        const profRes = await fetch(cfg.profileUrl, {
          headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', 'user-agent': 'uno-app' },
        });
        if (!profRes.ok) throw new Error(`profile fetch ${profRes.status}`);
        const profJson = await profRes.json();

        let parsed = cfg.parseProfile(profJson);
        // GitHub doesn't always return email on /user
        if (name === 'github' && !parsed.email) {
          try {
            const e = await fetch('https://api.github.com/user/emails', {
              headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', 'user-agent': 'uno-app' },
            });
            if (e.ok) {
              const list = await e.json();
              const primary = list.find(x => x.primary && x.verified) || list[0];
              if (primary) parsed.email = primary.email;
            }
          } catch {}
        }

        const user = await users.upsertUser({ provider: name, ...parsed });
        // Bootstrap admins from ADMIN_EMAILS (comma-separated) on login.
        const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (parsed.email && adminEmails.includes(parsed.email.toLowerCase())) {
          await users.grantAdminByEmail(parsed.email).catch(() => {});
          user.is_admin = true;
        }
        // Banned accounts cannot sign in.
        if (user.is_banned) {
          audit.log('auth.banned', { actorUserId: user.id, actorName: user.display_name, req, meta: { provider: name } });
          return res.status(403).send('This account has been suspended.');
        }
        const sid = await users.createSession(user.id);
        setSessionCookie(res, sid);
        const ret = safeReturnUrl(req.cookies?.[RETURN_COOKIE]);
        res.clearCookie(RETURN_COOKIE, { path: '/' });
        audit.log('auth.login', {
          actorUserId: user.id, actorName: user.display_name, req,
          meta: { provider: name, return: ret },
        });
        res.redirect(ret);
      } catch (e) {
        console.error(`[AUTH] ${name} callback error:`, e.message);
        audit.log('auth.fail', { req, meta: { provider: name, reason: e.message } });
        res.status(500).send('Sign-in failed. Please try again.');
      }
    });
  }
}

module.exports = {
  register,
  isConfigured,
  readSidFromCookieHeader,
  SESSION_COOKIE,
};

// Admin + moderation REST API. Mounted by the hub (and optionally games).
// Every route requires a signed-in account with is_admin = true.
//
//   app.use(createAdminRouter())
//
// Admin accounts are bootstrapped from the ADMIN_EMAILS env var (comma-separated)
// at OAuth login time; additional admins can be granted here by an existing admin.

const express = require('express');
const users = require('./db/users');
const db = require('./db');
const session = require('./session');
const audit = require('./audit');
const notify = require('./notify');

function createAdminRouter() {
  const router = express.Router();

  async function adminFromReq(req) {
    if (!db.isReady()) return null;
    const sid = req.cookies?.[session.COOKIE_NAME];
    if (!sid) return null;
    const user = await users.findUserBySession(sid).catch(() => null);
    return user && user.is_admin ? user : null;
  }

  // Gate every /api/admin route.
  router.use('/api/admin', async (req, res, next) => {
    const admin = await adminFromReq(req);
    if (!admin) return res.status(403).json({ error: 'Admins only' });
    req.admin = admin;
    next();
  });

  router.get('/api/admin/online', async (req, res) => {
    try {
      const list = await users.getOnlineUsers(120);
      res.json({ online: list.map(u => ({
        id: u.id, displayName: u.display_name, isGuest: u.is_guest,
        isAdmin: u.is_admin, isBanned: u.is_banned, lastSeen: u.last_seen,
      })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/admin/stats', async (req, res) => {
    try { res.json({ stats: await users.platformStats() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/admin/audit', async (req, res) => {
    try {
      const entries = await audit.recent({ limit: 40, event: req.query.event || null });
      res.json({ entries });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/admin/purge-guests', async (req, res) => {
    try {
      const removed = await users.purgeGuests();
      audit.log('admin.purge_guests', { actorUserId: req.admin.id, actorName: req.admin.display_name, req, meta: { removed } });
      res.json({ ok: true, removed });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // An admin toggles whether their own "ADMIN" badge shows publicly.
  router.post('/api/admin/set-badge', async (req, res) => {
    try {
      const r = await users.setAdminBadge(req.admin.id, !!(req.body && req.body.show));
      res.json({ ok: true, showAdminBadge: r ? r.show_admin_badge : true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/admin/players', async (req, res) => {
    try {
      const list = await users.listPlayers({ q: req.query.q || '', limit: 60, includeGuests: req.query.guests === '1' });
      res.json({ players: list.map(u => ({
        id: u.id, displayName: u.display_name, provider: u.provider,
        isGuest: u.is_guest, isAdmin: u.is_admin, isBanned: u.is_banned,
        banReason: u.ban_reason, createdAt: u.created_at, lastSeen: u.last_seen,
      })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/admin/ban', async (req, res) => {
    const { userId, reason } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (userId === req.admin.id) return res.status(400).json({ error: 'You cannot ban yourself' });
    const target = await users.findById(userId).catch(() => null);
    if (target && target.is_admin) return res.status(400).json({ error: 'Cannot ban another admin' });
    try {
      const r = await users.setBanned(userId, true, reason);
      audit.log('admin.ban', { actorUserId: req.admin.id, actorName: req.admin.display_name, req, target: userId, meta: { reason: reason || null } });
      res.json({ ok: true, user: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/admin/unban', async (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
      const r = await users.setBanned(userId, false);
      audit.log('admin.unban', { actorUserId: req.admin.id, actorName: req.admin.display_name, req, target: userId });
      res.json({ ok: true, user: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/admin/set-admin', async (req, res) => {
    const { userId, admin } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (userId === req.admin.id && admin === false) return res.status(400).json({ error: 'You cannot remove your own admin role' });
    try {
      const r = await users.setAdmin(userId, !!admin);
      audit.log('admin.role', { actorUserId: req.admin.id, actorName: req.admin.display_name, req, target: userId, meta: { admin: !!admin } });
      res.json({ ok: true, user: r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

module.exports = { createAdminRouter };

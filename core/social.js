// Shared social REST API (accounts, friends, DMs) mounted by every service.
//
// Game-agnostic: stats, display-name changes, friend requests, and direct
// messages live here so the hub and all games expose an identical social layer
// over the shared Postgres DB. Game-specific endpoints (room hashing, invites
// tied to a live room, per-game online counts) stay in each game server.
//
// Usage:
//   app.use(createSocialRouter({ getOnlineUserIds, notifyUser }))
//   - getOnlineUserIds(): () => Set<userId> connected to THIS service
//   - notifyUser(userId, payload): cross-service delivery (see core/notify.js)

const express = require('express');
const users = require('./db/users');
const friends = require('./db/friends');
const db = require('./db');
const session = require('./session');
const audit = require('./audit');
const { filterMessage, containsBadWord } = require('./profanity');

function createSocialRouter({ getOnlineUserIds, notifyUser }) {
  const router = express.Router();

  async function authFromReq(req) {
    if (!db.isReady()) return null;
    const sid = req.cookies?.[session.COOKIE_NAME];
    if (!sid) return null;
    return users.findUserBySession(sid).catch(() => null);
  }

  router.get('/api/stats/:userId', async (req, res) => {
    try {
      const user = await users.findById(req.params.userId);
      if (!user) return res.status(404).json({ error: 'not found' });
      const stats = await users.getStats(user.id);
      res.json({ displayName: user.display_name, ...stats });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Directory search — find people to message or friend. Registered users only.
  router.get('/api/users/search', async (req, res) => {
    const user = await authFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (user.is_guest) return res.status(403).json({ error: 'Guests must sign in to do that' });
    try {
      const results = await users.searchByName(req.query.q, user.id, 10);
      const onlineIds = getOnlineUserIds ? getOnlineUserIds() : new Set();
      res.json({ results: results.map(u => ({
        id: u.id, displayName: u.display_name, avatarUrl: u.avatar_url, online: onlineIds.has(u.id),
      })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // All DM conversations (open DMs — friendship not required).
  router.get('/api/dm-threads', async (req, res) => {
    const user = await authFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (user.is_guest) return res.status(403).json({ error: 'Guests must sign in to do that' });
    try {
      const threads = await friends.getConversations(user.id);
      res.json({ threads });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/auth/update-name', async (req, res) => {
    if (!db.isReady()) return res.status(503).json({ error: 'DB unavailable' });
    const user = await authFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (user.is_guest) return res.status(403).json({ error: 'Guests must sign in to do that' });
    const { name } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name required' });
    if (containsBadWord(name.trim())) {
      audit.log('chat.blocked', { actorUserId: user.id, actorName: user.display_name, req, meta: { field: 'display_name' } });
      return res.status(400).json({ error: 'Please choose a different name' });
    }
    try {
      const updated = await users.updateDisplayName(user.id, name);
      audit.log('account.rename', { actorUserId: user.id, actorName: updated, req, meta: { from: user.display_name } });
      res.json({ displayName: updated });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/api/friends', async (req, res) => {
    const user = await authFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (user.is_guest) return res.status(403).json({ error: 'Guests must sign in to do that' });
    const [list, pending, sent, unread] = await Promise.all([
      friends.getFriends(user.id),
      friends.getPendingRequests(user.id),
      friends.getSentRequests(user.id),
      friends.getUnreadCounts(user.id),
    ]);
    const onlineIds = getOnlineUserIds ? getOnlineUserIds() : new Set();
    const friendsWithStatus = list.map(f => ({
      ...f, online: onlineIds.has(f.id), unread: unread[f.id] || 0,
    }));
    res.json({ friends: friendsWithStatus, pending, sent });
  });

  router.post('/api/friends/request', async (req, res) => {
    const user = await authFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (user.is_guest) return res.status(403).json({ error: 'Guests must sign in to do that' });
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name required' });
    const target = await users.findByDisplayName(name.trim()).catch(() => null);
    if (!target) return res.status(404).json({ error: 'Player not found' });
    try {
      const result = await friends.sendRequest(user.id, target.id);
      if (result === 'accepted') {
        notifyUser(target.id, { type: 'friend_accepted', name: user.display_name });
      } else {
        notifyUser(target.id, { type: 'friend_request', from: user.display_name, fromId: user.id });
      }
      audit.log('friend.request', { actorUserId: user.id, actorName: user.display_name, req, target: target.id, meta: { result: result || 'sent' } });
      res.json({ ok: true, status: result || 'sent' });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.post('/api/friends/accept', async (req, res) => {
    const user = await authFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (user.is_guest) return res.status(403).json({ error: 'Guests must sign in to do that' });
    const { fromUserId } = req.body || {};
    if (!fromUserId) return res.status(400).json({ error: 'Missing fromUserId' });
    try {
      await friends.acceptRequest(fromUserId, user.id);
      notifyUser(fromUserId, { type: 'friend_accepted', name: user.display_name });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/api/friends/reject', async (req, res) => {
    const user = await authFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (user.is_guest) return res.status(403).json({ error: 'Guests must sign in to do that' });
    const { fromUserId } = req.body || {};
    if (!fromUserId) return res.status(400).json({ error: 'Missing fromUserId' });
    try {
      await friends.rejectRequest(fromUserId, user.id);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/api/friends/remove', async (req, res) => {
    const user = await authFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (user.is_guest) return res.status(403).json({ error: 'Guests must sign in to do that' });
    const { friendId } = req.body || {};
    if (!friendId) return res.status(400).json({ error: 'Missing friendId' });
    try {
      await friends.removeFriend(user.id, friendId);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.get('/api/dm/:friendId', async (req, res) => {
    const user = await authFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (user.is_guest) return res.status(403).json({ error: 'Guests must sign in to do that' });
    try {
      const msgs = await friends.getConversation(user.id, req.params.friendId);
      await friends.markRead(user.id, req.params.friendId);
      res.json({ messages: msgs });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/api/dm/:friendId', async (req, res) => {
    const user = await authFromReq(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    if (user.is_guest) return res.status(403).json({ error: 'Guests must sign in to do that' });
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Text required' });
    // Target must be a real (non-guest) account. Open DMs: no friendship needed.
    const target = await users.findById(req.params.friendId).catch(() => null);
    if (!target || target.is_guest) return res.status(404).json({ error: 'Player not found' });
    const filtered = filterMessage(text);
    if (!filtered) return res.status(400).json({ error: 'Invalid message' });
    if (filtered !== text.trim().slice(0, 200)) {
      audit.log('chat.blocked', { actorUserId: user.id, actorName: user.display_name, req, target: req.params.friendId, meta: { channel: 'dm' } });
    }
    try {
      const msg = await friends.sendDM(user.id, req.params.friendId, filtered);
      audit.log('dm.send', { actorUserId: user.id, actorName: user.display_name, req, target: req.params.friendId });
      notifyUser(req.params.friendId, {
        type: 'dm', fromId: user.id, fromName: user.display_name, text: filtered, ts: msg.ts,
      });
      res.json({ ok: true, message: msg });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  return router;
}

module.exports = { createSocialRouter };

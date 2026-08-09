// Rosemont Games shared core: auth, DB, sessions, social API, and cross-service
// notifications. Every service (hub + each game) requires this so accounts,
// friends, DMs, and OAuth behave identically platform-wide.

const db = require('./db');
const oauth = require('./auth/oauth');
const session = require('./session');
const notify = require('./notify');
const profanity = require('./profanity');
const quickchat = require('./quickchat');
const audit = require('./audit');
const { createSocialRouter } = require('./social');
const { createAdminRouter } = require('./admin');

module.exports = {
  db,
  oauth,
  session,
  notify,
  profanity,
  quickchat,
  audit,
  createSocialRouter,
  createAdminRouter,
};

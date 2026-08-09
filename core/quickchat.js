// Quick-chat phrase bank for guests (and anyone who prefers canned chat).
//
// Guests can ONLY send messages from this list — the server validates against it,
// so there is no free-text / profanity surface for guest accounts. Registered
// users keep full free-text chat. Keep phrases short, friendly, and game-neutral.

const PHRASES = [
  'Hi!',
  'Good game!',
  'Nice play!',
  'Your turn',
  'Oops!',
  'Thanks!',
  'Close one!',
  'Well played',
  'Good luck!',
  'So close!',
  'UNO!',
  'Nice hand!',
  'All in!',
  '👍',
  '😂',
  '🎉',
];

const PHRASE_SET = new Set(PHRASES);

// True if `text` is an allowed canned phrase (exact match).
function isQuickChat(text) {
  return typeof text === 'string' && PHRASE_SET.has(text);
}

module.exports = { PHRASES, isQuickChat };

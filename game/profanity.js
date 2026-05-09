const BAD_WORDS = [
  'fuck', 'fucking', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy',
  'bastard', 'nigger', 'nigga', 'faggot', 'retard', 'slut', 'whore',
  'piss', 'bollocks', 'wanker', 'twat', 'arse', 'ass',
];

function filterMessage(text) {
  if (typeof text !== 'string') return '';
  let out = text.trim().slice(0, 200);
  for (const word of BAD_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, 'gi');
    out = out.replace(re, m => '*'.repeat(m.length));
  }
  return out;
}

function containsBadWord(text) {
  if (typeof text !== 'string') return false;
  for (const word of BAD_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(text)) return true;
  }
  return false;
}

module.exports = { filterMessage, containsBadWord };

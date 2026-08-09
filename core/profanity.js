// Profanity / username filter.
//
// Two-pass matcher resilient to common bypass tricks:
//   1. Per-token: each whitespace-separated token is normalized
//      (lowercase, strip diacritics, leet→letter, drop non-letters)
//      and compared exactly against BAD_WORDS. Catches "sh1t",
//      "f.u.c.k", "fück", "ASShole".
//   2. Sliding window over consecutive single-letter tokens.
//      Catches "s h i t", "S H 1 T", "f u c k".
//
// Exact word match (after normalization) is intentional — it
// avoids false positives like "classic" → "ass", "pass" → "ass",
// "assassinate" → "ass". Users can add explicit variants to the
// word list as needed.

const BAD_WORDS = [
  // F-word variants
  'fuck', 'fucking', 'fucked', 'fucker', 'fucks', 'fuckin', 'fuckhead', 'motherfucker', 'motherfucking', 'fck', 'fkn',
  // S-word variants
  'shit', 'shitting', 'shitter', 'shitty', 'bullshit', 'horseshit', 'dipshit',
  // B-word variants
  'bitch', 'bitches', 'bitching', 'bitchy', 'bastard',
  // C-words
  'cunt', 'cunts',
  'cock', 'cocks', 'cocksucker', 'cockhead',
  // D-words
  'dick', 'dicks', 'dickhead', 'dickface', 'douchebag', 'douche',
  // P-words
  'pussy', 'pussies', 'prick', 'pricks',
  // A-words
  'ass', 'asses', 'asshole', 'assholes', 'asshat', 'asswipe', 'jackass',
  'arse', 'arses', 'arsehole', 'arseholes',
  // Sexual
  'tits', 'titties', 'boobs',
  'jizz', 'cum', 'cumshot',
  'blowjob', 'handjob', 'rimjob',
  'wank', 'wanker', 'wanking', 'wankers',
  'porn', 'porno',
  'slut', 'whore', 'hooker', 'skank',
  // Hate speech / slurs
  'nigger', 'nigga', 'niggas', 'niggers',
  'faggot', 'faggots', 'fag', 'fags',
  'retard', 'retarded', 'retards',
  'kike', 'kikes',
  'chink', 'chinks',
  'spic', 'spics',
  'wetback', 'wetbacks',
  'beaner', 'beaners',
  'gook', 'gooks',
  'tranny', 'trannies',
  'cracker', 'honky',
  // Misc strong profanity
  'piss', 'pissing',
  'bollocks',
  'twat', 'twats',
  'schmuck',
];

const LEET_MAP = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a',
  '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '|': 'i',
};

const BAD_SET = new Set(BAD_WORDS.map(w => w.toLowerCase()));
const MIN_BAD_LEN = Math.min(...BAD_WORDS.map(w => w.length));

// Words safe to match as a SUBSTRING inside a longer token — catches run-together
// bypasses like "fuckyou", "dumbshit", "youreanasshole". Deliberately excludes
// short/ambiguous stems (ass, cum, fag, cock, dick) that cause false positives
// (class, cocktail, Dickinson…). "cunt" is borderline (Scunthorpe) but kept since
// the false-positive surface is tiny for a chat game. Keep this list conservative.
const SUBSTRING_WORDS = [
  'fuck', 'shit', 'bitch', 'pussy', 'nigger', 'nigga', 'faggot',
  'motherfucker', 'cocksucker', 'asshole', 'dickhead', 'bullshit',
  'whore', 'wanker', 'retarded',
];

// Collapse runs of the same letter so "fuuuck" → "fuck", "shiiit" → "shit".
function collapseRepeats(s) {
  return s.replace(/(.)\1+/g, '$1');
}

// True if a normalized token is (or, de-elongated, becomes) a bad word, or
// contains one of the conservative substring words.
function tokenIsBad(norm) {
  if (norm.length < MIN_BAD_LEN) return false;
  if (BAD_SET.has(norm)) return true;
  const collapsed = collapseRepeats(norm);
  if (collapsed.length >= MIN_BAD_LEN && BAD_SET.has(collapsed)) return true;
  for (const w of SUBSTRING_WORDS) {
    if (norm.includes(w) || collapsed.includes(w)) return true;
  }
  return false;
}

// Normalize a single token to canonical letters-only lowercase.
// Returns '' for tokens that contain no recognizable letters.
function normalizeWord(token) {
  const stripped = token.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  let out = '';
  for (const ch of stripped) {
    if (LEET_MAP[ch]) out += LEET_MAP[ch];
    else if (ch >= 'a' && ch <= 'z') out += ch;
  }
  return out;
}

// Returns array of {start, end, text} for each whitespace-separated token.
function tokenize(text) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return tokens;
}

// Set of token indexes that should be masked.
function findBadTokens(tokens) {
  const bad = new Set();
  const norms = tokens.map(t => normalizeWord(t.text));

  // Pass A — single-token match (exact, de-elongated, or conservative substring).
  for (let i = 0; i < tokens.length; i++) {
    if (tokenIsBad(norms[i])) bad.add(i);
  }

  // Pass B — sliding window over runs of consecutive single-letter tokens.
  // E.g., "s h i t" → 4 tokens of length 1; concat to "shit" and check.
  let i = 0;
  while (i < tokens.length) {
    if (norms[i].length !== 1) { i++; continue; }
    let j = i;
    while (j < tokens.length && norms[j].length === 1) j++;
    // tokens [i..j-1] are a run of single-letter tokens
    if (j - i >= MIN_BAD_LEN) {
      for (let a = i; a < j; a++) {
        for (let b = a + MIN_BAD_LEN - 1; b < j; b++) {
          const concat = norms.slice(a, b + 1).join('');
          if (BAD_SET.has(concat)) {
            for (let k = a; k <= b; k++) bad.add(k);
          }
        }
      }
    }
    i = j;
  }

  return bad;
}

function filterMessage(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim().slice(0, 200);
  if (!trimmed) return '';

  const tokens = tokenize(trimmed);
  const bad = findBadTokens(tokens);
  if (bad.size === 0) return trimmed;

  const chars = [...trimmed];
  for (const idx of bad) {
    const tok = tokens[idx];
    for (let i = tok.start; i < tok.end; i++) {
      if (chars[i] && /\S/.test(chars[i])) chars[i] = '*';
    }
  }
  return chars.join('');
}

function containsBadWord(text) {
  if (typeof text !== 'string') return false;
  const tokens = tokenize(text);
  return findBadTokens(tokens).size > 0;
}

module.exports = { filterMessage, containsBadWord, normalizeWord, BAD_WORDS };

const BAD_WORDS = [
  // F-word variants
  'fuck', 'fucking', 'fucked', 'fucker', 'fucks', 'fuckin', 'fuckhead', 'motherfucker', 'motherfucking',
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
  'schmuck', 'jackass',
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

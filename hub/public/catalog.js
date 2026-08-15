/* Rosemont Games hub — catalog page logic.
 *
 * Base-path aware: the page may be served at a domain root (gamehub.rosemont.place)
 * OR mounted under a subpath for testing (uno.rosemont.place/hub/). Every API/WS/asset
 * URL is resolved relative to BASE so the same file works in both places.
 */
'use strict';

// Directory of the current document, e.g. "/" or "/hub/". Always ends in "/".
const BASE = location.pathname.replace(/[^/]*$/, '');
const api = (p) => BASE + p.replace(/^\//, '');            // BASE-relative fetch path
const abs = (p) => location.origin + BASE + p.replace(/^\//, ''); // absolute URL

// Make OG/Twitter image absolute so link-preview crawlers resolve it on any host.
for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]',
                   'meta[property="og:url"]']) {
  const m = document.querySelector(sel);
  if (m && m.getAttribute('property') === 'og:url') m.setAttribute('content', location.href);
  else if (m) m.setAttribute('content', abs('og.png'));
}

// ── Game catalog ─────────────────────────────────────────────────────────────
// `live: true` games link out to play; others render as "Coming soon" with rules.
// gameUrl(): in local dev each game runs on its own port; in production every game
// is mounted under a subpath on this origin (nginx routes /uno/ and /holdem/).
function gameUrl(devPort, subpath) {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    return 'http://' + h + ':' + devPort;  // local dev: game on its own port
  }
  return location.origin + subpath;        // production: game under its subpath
}

const GAMES = [
  {
    id: 'uno', name: 'UNO', icon: 'U', live: true, url: gameUrl(5050, '/uno/'),
    desc: 'The classic color-and-number shed. Match, stack, and shout UNO before your last card.',
    rules: [
      ['Goal', 'Be the first to empty your hand. Match the top card by color, number, or symbol.'],
      ['Action cards', 'Skip, Reverse, and Draw Two hit the next player. Wild lets you pick a color; Wild Draw Four also forces four cards.'],
      ['Saying UNO', 'When you have one card left you must call "UNO" — get caught silent and you draw a penalty.'],
      ['Winning', 'First to zero cards wins the round.'],
    ],
  },
  {
    id: 'holdem', name: "Texas Hold'em", icon: '♠', live: true, url: gameUrl(5070, '/holdem/'),
    desc: 'No-limit poker. Two hole cards, five community cards, and all the bluffing you can muster.',
    rules: [
      ['Goal', 'Make the best five-card hand from your two hole cards and five shared community cards.'],
      ['Betting rounds', 'Pre-flop, flop, turn, and river — bet, call, raise, or fold each round.'],
      ['Showdown', 'Remaining players reveal; best hand takes the pot.'],
    ],
  },
  {
    id: 'ginrummy', name: 'Gin Rummy', icon: '♦', live: true, url: gameUrl(5080, '/ginrummy/'),
    desc: 'Two-player draw-and-discard. Build runs and sets, then knock to end the hand.',
    rules: [
      ['Goal', 'Form sets of equal ranks and suited runs of three or more while minimizing unmatched deadwood. Aces are low and worth 1; face cards are worth 10.'],
      ['Your turn', 'Draw the top stock card or visible discard, then discard one card. A discard you just picked up cannot be put straight back.'],
      ['Knocking', 'After drawing, end the hand with 10 or less deadwood. The defender may lay off against your melds; going gin with zero deadwood prevents layoffs and adds 20 points.'],
      ['Scoring', 'A knock scores the deadwood difference. A tie or lower defender total earns a 10-point undercut bonus. First to 100 hand points wins, followed by official game, box, and shutout bonuses.'],
    ],
  },
  {
    id: 'blackjack', name: 'Blackjack', icon: '♣', live: true, url: gameUrl(5090, '/blackjack/'),
    desc: 'Casino classic 21. Hit, stand, double down, split pairs, and beat the dealer without busting.',
    rules: [
      ['Goal', 'Get closer to 21 than the dealer without going over (busting). Natural Blackjack pays 3:2.'],
      ['Cards', 'Face cards (J, Q, K) are 10; Aces are 1 or 11. Hard hands have no flexible Ace; soft hands contain an Ace counted as 11.'],
      ['Actions', 'Hit to draw more cards, Stand to keep your total, Double Down to double your bet for one card, or Split matching pairs into two hands.'],
      ['Dealer rules', 'The dealer must draw cards until reaching at least 17, and must stand on all 17s.'],
      ['Payouts', 'Natural Blackjack pays 3:2; standard wins pay 1:1; pushes refund your bet; insurance against dealer Ace pays 2:1.'],
    ],
  },
  {
    id: 'canasta', name: 'Canasta', icon: '♥', live: false,
    desc: 'Partnership rummy with melds of seven — the canastas — wild cards, and big scores.',
    rules: [
      ['Goal', 'With your partner, form melds and complete canastas (melds of seven cards).'],
      ['Wild cards', 'Twos and jokers are wild and can extend melds within limits.'],
      ['Scoring', 'Canastas and card values score points; first partnership to 5000 wins.'],
    ],
  },
  {
    id: 'bridge', name: 'Bridge', icon: '♠', live: false,
    desc: 'The classic trick-taking partnership game. Bid the contract, then play to make it.',
    rules: [
      ['Goal', 'Win tricks in partnership to fulfill your bid contract.'],
      ['Bidding', 'Auction to set the contract — the level and trump suit (or no-trump).'],
      ['Play', 'Play thirteen tricks; declarer tries to make the contract, defenders to break it.'],
    ],
  },
];

// ── Per-game decoration: accent color + a small SVG "scene" of game pieces ────
const ACCENT = {
  uno: '#d11f2d', holdem: '#15803d', ginrummy: '#ea580c',
  blackjack: '#0e7490', canasta: '#9333ea', bridge: '#1d4ed8',
};
const ART = {
  uno: `<svg viewBox="0 0 140 90" class="art-svg" xmlns="http://www.w3.org/2000/svg">
    <rect x="38" y="24" width="32" height="46" rx="5" fill="#facc15" transform="rotate(-18 54 47)"/>
    <rect x="54" y="21" width="32" height="46" rx="5" fill="#22c55e" transform="rotate(-6 70 44)"/>
    <rect x="70" y="24" width="32" height="46" rx="5" fill="#3b82f6" transform="rotate(12 86 47)"/>
    <rect x="55" y="22" width="32" height="46" rx="5" fill="#d11f2d"/>
    <ellipse cx="71" cy="45" rx="13" ry="18" fill="#fff" transform="rotate(22 71 45)"/>
    <text x="71" y="52" text-anchor="middle" font-family="Georgia,serif" font-weight="800" font-size="18" fill="#d11f2d">7</text>
  </svg>`,
  holdem: `<svg viewBox="0 0 140 90" class="art-svg" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="58" r="15" fill="#d11f2d" stroke="#fff" stroke-width="3" stroke-dasharray="5 5"/>
    <rect x="60" y="24" width="34" height="50" rx="5" fill="#fbfbfb" stroke="rgba(0,0,0,.12)" transform="rotate(-8 77 49)"/>
    <rect x="76" y="20" width="34" height="50" rx="5" fill="#fbfbfb" stroke="rgba(0,0,0,.12)"/>
    <text x="93" y="38" text-anchor="middle" font-size="12" font-weight="800" fill="#111">A</text>
    <text x="93" y="58" text-anchor="middle" font-size="22" fill="#111">♠</text>
  </svg>`,
  ginrummy: `<svg viewBox="0 0 140 90" class="art-svg" xmlns="http://www.w3.org/2000/svg">
    <rect x="42" y="26" width="32" height="46" rx="5" fill="#fbfbfb" stroke="rgba(0,0,0,.12)" transform="rotate(-12 58 49)"/>
    <rect x="58" y="22" width="32" height="46" rx="5" fill="#fbfbfb" stroke="rgba(0,0,0,.12)"/>
    <rect x="74" y="26" width="32" height="46" rx="5" fill="#fbfbfb" stroke="rgba(0,0,0,.12)" transform="rotate(12 90 49)"/>
    <text x="74" y="52" text-anchor="middle" font-size="24" fill="#ea580c">♦</text>
  </svg>`,
  blackjack: `<svg viewBox="0 0 140 90" class="art-svg" xmlns="http://www.w3.org/2000/svg">
    <rect x="44" y="24" width="34" height="50" rx="5" fill="#fbfbfb" stroke="rgba(0,0,0,.12)" transform="rotate(-8 61 49)"/>
    <rect x="66" y="20" width="34" height="50" rx="5" fill="#fbfbfb" stroke="rgba(0,0,0,.12)"/>
    <text x="83" y="42" text-anchor="middle" font-size="17" font-weight="800" fill="#111">21</text>
    <text x="83" y="62" text-anchor="middle" font-size="17" fill="#111">♠</text>
  </svg>`,
  canasta: `<svg viewBox="0 0 140 90" class="art-svg" xmlns="http://www.w3.org/2000/svg">
    <rect x="40" y="28" width="30" height="44" rx="5" fill="#fbfbfb" stroke="rgba(0,0,0,.12)" transform="rotate(-16 55 50)"/>
    <rect x="55" y="24" width="30" height="44" rx="5" fill="#fbfbfb" stroke="rgba(0,0,0,.12)"/>
    <rect x="70" y="28" width="30" height="44" rx="5" fill="#fbfbfb" stroke="rgba(0,0,0,.12)" transform="rotate(16 85 50)"/>
    <text x="70" y="53" text-anchor="middle" font-size="22" fill="#d11f2d">♥</text>
  </svg>`,
  bridge: `<svg viewBox="0 0 140 90" class="art-svg" xmlns="http://www.w3.org/2000/svg">
    <rect x="46" y="22" width="48" height="48" rx="8" fill="#fbfbfb" stroke="rgba(0,0,0,.12)"/>
    <text x="60" y="44" text-anchor="middle" font-size="17" fill="#111">♠</text>
    <text x="80" y="44" text-anchor="middle" font-size="17" fill="#d11f2d">♥</text>
    <text x="60" y="63" text-anchor="middle" font-size="17" fill="#d11f2d">♦</text>
    <text x="80" y="63" text-anchor="middle" font-size="17" fill="#111">♣</text>
  </svg>`,
};

// ── Render catalog ───────────────────────────────────────────────────────────
// One full-width strip of decorated game cards; scroll sideways for more.
function renderCatalog() {
  const root = document.getElementById('catalog');
  root.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'catalog-head';
  const liveCount = GAMES.filter(g => g.live).length;
  head.innerHTML = `<h2>Games</h2><span class="hint">${liveCount} live · scroll for more →</span>`;
  root.appendChild(head);
  const list = document.createElement('div');
  list.className = 'game-list';

  GAMES.forEach((g, i) => {
    const row = document.createElement('div');
    row.className = 'game-card ' + (g.live ? 'live' : 'soon');
    row.style.setProperty('--game-accent', ACCENT[g.id] || 'var(--red)');
    row.style.setProperty('--i', i);   // staggered load-in animation delay
    row.innerHTML = `
      <div class="game-art">${ART[g.id] || ''}
        <span class="badge ${g.live ? 'live' : ''}">${g.live ? 'Live' : 'Coming soon'}</span>
      </div>
      <div class="game-body">
        <div class="game-name">${g.name}</div>
        <p class="game-desc">${g.desc}</p>
        ${g.live ? `<div class="game-activity" id="activity-${g.id}"></div>` : ''}
        <div class="game-actions"></div>
      </div>`;
    const actions = row.querySelector('.game-actions');

    if (g.live) {
      const play = document.createElement('a');
      play.className = 'btn btn-primary btn-sm';
      play.href = g.url;
      play.textContent = 'Play';
      actions.appendChild(play);
    } else {
      const soon = document.createElement('button');
      soon.className = 'btn btn-sm';
      soon.disabled = true;
      soon.textContent = 'Soon';
      actions.appendChild(soon);
    }
    const rules = document.createElement('button');
    rules.className = 'btn btn-ghost btn-sm';
    rules.textContent = 'Rules';
    rules.addEventListener('click', () => openRules(g));
    actions.appendChild(rules);

    list.appendChild(row);
  });
  root.appendChild(list);
}

// ── Rules modal ──────────────────────────────────────────────────────────────
const rulesOverlay = document.getElementById('rules-overlay');
function openRules(g) {
  document.getElementById('rules-title').textContent = g.name + ' — how to play';
  document.getElementById('rules-sub').textContent = g.live ? 'Ready to play now.' : 'Coming soon to Rosemont.';
  document.getElementById('rules-body').innerHTML = g.rules
    .map(([h, p]) => `<h4>${h}</h4><p>${p}</p>`).join('');
  rulesOverlay.classList.add('open');
}
document.getElementById('rules-close').addEventListener('click', () => rulesOverlay.classList.remove('open'));
rulesOverlay.addEventListener('click', (e) => { if (e.target === rulesOverlay) rulesOverlay.classList.remove('open'); });

// ── Sign-in modal ────────────────────────────────────────────────────────────
const signinOverlay = document.getElementById('signin-overlay');
function openSignin() { signinOverlay.classList.add('open'); }
function closeSignin() { signinOverlay.classList.remove('open'); }
document.getElementById('signin-close').addEventListener('click', closeSignin);
signinOverlay.addEventListener('click', (e) => { if (e.target === signinOverlay) closeSignin(); });

// Deep link from the shared footer: /#signin opens the sign-in dialog for
// signed-out visitors (waits briefly for loadMe to resolve currentUser).
if (location.hash === '#signin') {
  setTimeout(() => { if (!currentUser) openSignin(); }, 450);
}

// Google's brand mark, reused from the game UI so sign-in looks identical everywhere.
const GOOGLE_ICON = '<svg class="google-icon" viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';

// /auth/providers returns { google: bool, github: bool } — turn that into buttons.
async function loadProviders() {
  const box = document.getElementById('signin-providers');
  let data = {};
  try {
    const r = await fetch(api('auth/providers'));
    data = await r.json();
  } catch {
    box.innerHTML = '<p class="signin-guest-note">Sign-in is unavailable right now.</p>';
    return;
  }
  const ret = encodeURIComponent(location.href);
  box.innerHTML = '';
  if (data.google) {
    const a = document.createElement('a');
    a.className = 'btn btn-google';
    a.href = api(`auth/google?return=${ret}`);
    a.innerHTML = `${GOOGLE_ICON}<span>Continue with Google</span>`;
    box.appendChild(a);
  }
  if (data.github) {
    const a = document.createElement('a');
    a.className = 'btn';
    a.href = api(`auth/github?return=${ret}`);
    a.textContent = 'Continue with GitHub';
    box.appendChild(a);
  }
  if (!data.google && !data.github) {
    box.innerHTML = '<p class="signin-guest-note">No sign-in providers configured on this server.</p>';
  }
}

// ── Guest ────────────────────────────────────────────────────────────────────
async function playAsGuest() {
  try {
    const r = await fetch(api('auth/guest'), { method: 'POST' });
    if (r.ok) { location.reload(); return; }
  } catch {}
  toast('Guest mode unavailable', 'Could not start a guest session — try again shortly.');
}

// ── Auth widget (signed-out / guest / registered) ────────────────────────────
let currentUser = null;

async function logout() {
  try { await fetch(api('auth/logout'), { method: 'POST' }); } catch {}
  location.reload();
}

async function loadMe() {
  let me = null;
  try {
    const r = await fetch(api('auth/me'));
    if (r.ok) me = (await r.json()).user || null;
  } catch {}
  currentUser = me;

  // Topbar shows only a compact identity chip; all controls live in the
  // Community "Account" panel below the games.
  const chip = document.getElementById('topbar-user');
  if (chip) {
    if (!me) {
      chip.innerHTML = '';
    } else {
      const isGuest = !!me.isGuest || !!me.is_guest;
      const name = me.name || me.displayName || (isGuest ? 'Guest' : 'Player');
      const initial = (name.trim()[0] || '?').toUpperCase();
      chip.innerHTML = `<div class="user-chip ${isGuest ? 'guest' : ''}">
        <div class="avatar">${isGuest ? '●' : esc(initial)}</div>
        <span class="name">${esc(name)}${adminBadgeSpan()}</span>
      </div>`;
    }
  }
  renderCommunity();
}

// ── Themes ────────────────────────────────────────────────────────────────────
const THEMES = [
  { id: 'midnight', name: 'Midnight', swatch: '#0a0a0a' },
  { id: 'daylight', name: 'Daylight', swatch: '#f4f4f5' },
  { id: 'casino',   name: 'Casino',   swatch: '#0b3d2e' },
  { id: 'royal',    name: 'Royal',    swatch: '#241b4d' },
  { id: 'ember',    name: 'Ember',    swatch: '#301a12' },
  { id: 'ocean',    name: 'Ocean',    swatch: '#0b2338' },
];
function currentTheme() {
  try { return localStorage.getItem('rg_theme') || 'midnight'; } catch { return 'midnight'; }
}
function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem('rg_theme', id); } catch {}
  renderThemePicker();
}
function renderThemePicker() {
  const box = document.getElementById('theme-picker');
  if (!box) return;
  const active = currentTheme();
  box.innerHTML = '';
  for (const t of THEMES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-swatch' + (t.id === active ? ' active' : '');
    b.style.setProperty('--sw', t.swatch);
    b.innerHTML = `<span class="theme-dot"></span><span>${t.name}</span>`;
    b.addEventListener('click', () => applyTheme(t.id));
    box.appendChild(b);
  }
}
applyTheme(currentTheme()); // ensure attribute + picker reflect saved choice

// ── Account: display-name save (used by the Community "Account" panel) ───────
async function saveAccountName() {
  const input = document.getElementById('account-name');
  const msg = document.getElementById('account-msg');
  if (!input) return;
  const setMsg = (t, err) => { if (msg) { msg.textContent = t; msg.className = 'community-msg ' + (err ? 'error' : 'ok'); } };
  const name = input.value.trim();
  if (!name) return setMsg("Name can't be empty.", true);
  const current = currentUser && (currentUser.displayName || currentUser.display_name);
  if (name === current) return setMsg('That is already your name.', false);
  if (!window.confirm(`Change your display name to "${name}"?`)) return;
  try {
    const r = await fetch(api('auth/update-name'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(d.error || 'Could not save name.', true);
    setMsg('Saved.', false);
    loadMe();
  } catch { setMsg('Could not save name.', true); }
}

// Sign-in modal's guest button.
document.getElementById('guest-btn-2')?.addEventListener('click', playAsGuest);

// ── Community: friends + open DMs (registered users) ─────────────────────────
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let activeThread = null; // { id, name }

// Account panel HTML — adapts to signed-out / guest / registered. Holds the
// login/guest buttons, display-name editor, log out, and the theme picker.
function accountPanelHTML() {
  const isGuest = !!(currentUser && (currentUser.isGuest || currentUser.is_guest));
  const registered = !!currentUser && !isGuest;
  const name = currentUser ? (currentUser.displayName || currentUser.name || (isGuest ? 'Guest' : 'Player')) : '';
  const initial = (name.trim()[0] || '?').toUpperCase();

  let top;
  if (!currentUser) {
    top = `<p class="community-msg">Play instantly as a guest, or sign in to save progress, add friends, and message players.</p>
      <div class="account-actions">
        <button id="account-guest" class="btn btn-sm">Play as guest</button>
        <button id="account-signin" class="btn btn-primary btn-sm">Sign in</button>
      </div>`;
  } else {
    top = `<div class="account-id">
        <div class="user-chip ${isGuest ? 'guest' : ''}"><div class="avatar">${isGuest ? '●' : esc(initial)}</div><span class="name">${esc(name)}${adminBadgeSpan()}</span></div>
      </div>`;
    if (registered) {
      top += `<label class="settings-label" for="account-name">Display name</label>
        <div class="add-row">
          <input id="account-name" class="text-input" maxlength="20" autocomplete="off" value="${esc(name)}">
          <button id="account-save" class="btn btn-sm">Save</button>
        </div>
        <p id="account-msg" class="community-msg"></p>`;
      if (currentUser.isAdmin) {
        top += `<label class="settings-toggle"><input type="checkbox" id="admin-badge-cb" ${currentUser.showAdminBadge !== false ? 'checked' : ''}> Show my <b>ADMIN</b> badge to others</label>`;
      }
      top += `<div class="account-actions"><button id="account-logout" class="btn btn-sm btn-ghost">Log out</button></div>`;
    } else {
      top += `<div class="account-actions">
          <button id="account-signin" class="btn btn-primary btn-sm">Sign in to save</button>
          <button id="account-logout" class="btn btn-sm btn-ghost">Log out</button>
        </div>`;
    }
  }
  return `<div class="panel account-panel">
    <div class="panel-head">Settings</div>
    <div class="panel-body">
      <div class="settings-group">
        <label class="settings-label">Account</label>
        ${top}
      </div>
      <div class="settings-divider"></div>
      <div class="settings-group">
        <label class="settings-label">Appearance · Theme</label>
        <div id="theme-picker" class="theme-picker"></div>
      </div>
    </div>
  </div>`;
}

// The little "ADMIN" tag shown next to an admin's name when they've opted in.
function adminBadgeSpan() {
  return (currentUser && currentUser.isAdmin && currentUser.showAdminBadge !== false)
    ? ' <span class="tag admin">admin</span>' : '';
}

function wireAccountPanel() {
  document.getElementById('account-guest')?.addEventListener('click', playAsGuest);
  document.getElementById('account-signin')?.addEventListener('click', openSignin);
  document.getElementById('account-logout')?.addEventListener('click', logout);
  document.getElementById('account-save')?.addEventListener('click', saveAccountName);
  document.getElementById('account-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveAccountName(); });
  document.getElementById('admin-badge-cb')?.addEventListener('change', async (e) => {
    try { await fetch(api('api/admin/set-badge'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ show: e.target.checked }) }); } catch {}
    loadMe();
  });
}

function renderCommunity() {
  const body = document.getElementById('community-body');
  if (!body) return;
  const registered = !!(currentUser && !(currentUser.isGuest || currentUser.is_guest));

  const settings = accountPanelHTML();
  const admin = (currentUser && currentUser.isAdmin) ? adminPanelHTML() : '';

  // Signed-out / guest: greyed "join the community" box, then Settings below.
  if (!registered) {
    const guest = !!(currentUser && (currentUser.isGuest || currentUser.is_guest));
    const msg = guest ? "You're playing as a guest. Sign in to add friends and message players."
                      : 'Sign in to join the community — add friends and message any player.';
    body.innerHTML = `
      <div class="panel community-locked">
        <div class="locked-inner">
          <div class="locked-title">Community</div>
          <p>${esc(msg)}</p>
          <button id="locked-signin" class="btn btn-primary btn-sm">Sign in</button>
        </div>
      </div>
      ${settings}`;
    document.getElementById('locked-signin')?.addEventListener('click', openSignin);
    wireAccountPanel();
    renderThemePicker();
    return;
  }

  // Full-width stacked rows: Messages, then Friends, then Settings, then Admin.
  const messenger = `
    <div class="panel messenger" id="messenger">
      <div class="messenger-list">
        <div class="messenger-search">
          <input id="dm-search-input" class="text-input" placeholder="Search players…" autocomplete="off">
        </div>
        <div id="dm-search-results" class="people-list"></div>
        <div id="dm-threads" class="messenger-threads"></div>
      </div>
      <div class="messenger-chat" id="messenger-chat">
        <div class="messenger-empty">Select a conversation, or search for a player to start messaging.</div>
      </div>
    </div>`;
  const friends = `<div class="panel">
      <div class="panel-head">Friends</div>
      <div class="panel-body">
        <div class="add-row">
          <input id="friend-add-input" class="text-input" placeholder="Add by username" maxlength="20" autocomplete="off">
          <button id="friend-add-btn" class="btn btn-sm">Add</button>
        </div>
        <div id="friend-suggest" class="suggest-list"></div>
        <p id="friend-add-msg" class="community-msg"></p>
        <div id="friend-requests" class="req-list"></div>
        <div id="friend-list" class="people-list"></div>
      </div>
    </div>`;

  body.innerHTML = messenger + friends + settings + admin;
  wireAccountPanel();
  renderThemePicker();

  document.getElementById('friend-add-btn').addEventListener('click', addFriend);
  const fInput = document.getElementById('friend-add-input');
  fInput.addEventListener('keydown', e => { if (e.key === 'Enter') { addFriend(); clearSuggest('friend-suggest'); } });
  let ft;
  fInput.addEventListener('input', () => { clearTimeout(ft); ft = setTimeout(() => suggestPlayers(fInput.value.trim(), 'friend-suggest', name => { fInput.value = name; clearSuggest('friend-suggest'); addFriend(); }), 200); });

  const search = document.getElementById('dm-search-input');
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => searchUsers(search.value.trim()), 200); });
  loadFriends();
  loadThreads();
  if (activeThread) openThread(activeThread.id, activeThread.name);

  if (currentUser && currentUser.isAdmin) wireAdminPanel();
}

// Shared typeahead: list players matching `q` into `boxId`; onPick(name) on click.
async function suggestPlayers(q, boxId, onPick) {
  const box = document.getElementById(boxId);
  if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  let results = [];
  try { const r = await fetch(api('api/users/search?q=' + encodeURIComponent(q))); if (r.ok) results = (await r.json()).results || []; } catch {}
  box.innerHTML = results.map(u => `
    <button class="suggest-item" data-name="${esc(u.displayName)}">
      <span class="status-dot ${u.online ? 'on' : ''}"></span>${esc(u.displayName)}
    </button>`).join('');
  box.querySelectorAll('[data-name]').forEach(b => b.addEventListener('click', () => onPick(b.dataset.name)));
}
function clearSuggest(boxId) { const b = document.getElementById(boxId); if (b) b.innerHTML = ''; }

async function loadFriends() {
  const reqBox = document.getElementById('friend-requests');
  const listBox = document.getElementById('friend-list');
  if (!reqBox || !listBox) return;
  let data = { friends: [], pending: [] };
  try { const r = await fetch(api('api/friends')); if (r.ok) data = await r.json(); } catch {}

  reqBox.innerHTML = (data.pending || []).map(p => `
    <div class="person req">
      <span class="person-name">${esc(p.from_name)}</span>
      <span class="person-actions">
        <button class="btn btn-sm" data-accept="${esc(p.from_user_id)}">Accept</button>
        <button class="btn btn-sm btn-ghost" data-reject="${esc(p.from_user_id)}">Ignore</button>
      </span>
    </div>`).join('');

  listBox.innerHTML = (data.friends || []).length ? (data.friends || []).map(f => `
    <div class="person">
      <span class="person-name">
        <span class="status-dot ${f.online ? 'on' : ''}"></span>${esc(f.display_name)}
      </span>
      <span class="person-actions">
        <button class="btn btn-sm" data-msg="${esc(f.id)}" data-name="${esc(f.display_name)}">Message${f.unread ? ` <span class="unread">${f.unread}</span>` : ''}</button>
        <button class="btn btn-sm btn-ghost" data-remove="${esc(f.id)}" title="Remove friend">✕</button>
      </span>
    </div>`).join('') : '<p class="community-msg">No friends yet — add someone above.</p>';

  reqBox.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => friendAction('accept', b.dataset.accept)));
  reqBox.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => friendAction('reject', b.dataset.reject)));
  listBox.querySelectorAll('[data-msg]').forEach(b => b.addEventListener('click', () => openThread(b.dataset.msg, b.dataset.name)));
  listBox.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => friendAction('remove', b.dataset.remove)));
}

async function addFriend() {
  const input = document.getElementById('friend-add-input');
  const msg = document.getElementById('friend-add-msg');
  const name = input.value.trim();
  if (!name) return;
  try {
    const r = await fetch(api('api/friends/request'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { msg.textContent = d.error || 'Could not send request.'; msg.className = 'community-msg error'; return; }
    msg.textContent = d.status === 'accepted' ? 'You are now friends!' : 'Request sent.';
    msg.className = 'community-msg ok';
    input.value = '';
    loadFriends();
  } catch { msg.textContent = 'Could not send request.'; msg.className = 'community-msg error'; }
}

async function friendAction(kind, id) {
  const url = kind === 'accept' ? 'api/friends/accept' : kind === 'reject' ? 'api/friends/reject' : 'api/friends/remove';
  const body = kind === 'remove' ? { friendId: id } : { fromUserId: id };
  try { await fetch(api(url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch {}
  loadFriends();
}

async function searchUsers(q) {
  const box = document.getElementById('dm-search-results');
  if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  let results = [];
  try { const r = await fetch(api('api/users/search?q=' + encodeURIComponent(q))); if (r.ok) results = (await r.json()).results || []; } catch {}
  box.innerHTML = results.length ? results.map(u => `
    <div class="person">
      <span class="person-name"><span class="status-dot ${u.online ? 'on' : ''}"></span>${esc(u.displayName)}</span>
      <span class="person-actions"><button class="btn btn-sm" data-open="${esc(u.id)}" data-name="${esc(u.displayName)}">Message</button></span>
    </div>`).join('') : '<p class="community-msg">No players found.</p>';
  box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openThread(b.dataset.open, b.dataset.name)));
}

async function loadThreads() {
  const box = document.getElementById('dm-threads');
  if (!box) return;
  let threads = [];
  try { const r = await fetch(api('api/dm-threads')); if (r.ok) threads = (await r.json()).threads || []; } catch {}
  if (!threads.length) { box.innerHTML = '<p class="community-msg" style="padding:10px 12px">No conversations yet — search for a player above.</p>'; return; }
  box.innerHTML = threads.map(t => `
    <button class="thread-item ${activeThread && String(activeThread.id) === String(t.id) ? 'active' : ''}" data-open="${esc(t.id)}" data-name="${esc(t.display_name)}">
      <span class="thread-avatar">${esc((t.display_name.trim()[0] || '?').toUpperCase())}</span>
      <span class="thread-main">
        <span class="thread-top"><b>${esc(t.display_name)}</b><span class="thread-time">${fmtTime(t.last_ts)}</span></span>
        <span class="thread-preview">${esc((t.last_text || '').slice(0, 46))}</span>
      </span>
      ${t.unread ? `<span class="unread">${t.unread}</span>` : ''}
    </button>`).join('');
  box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openThread(b.dataset.open, b.dataset.name)));
}

async function openThread(id, name) {
  activeThread = { id, name };
  // Highlight in list; mark the messenger as showing a chat (mobile toggle).
  document.getElementById('messenger')?.classList.add('has-active');
  document.querySelectorAll('.thread-item').forEach(el => el.classList.toggle('active', el.dataset.open === String(id)));
  const chat = document.getElementById('messenger-chat');
  if (!chat) return;
  chat.innerHTML = `
    <div class="chat-head">
      <button class="btn btn-sm btn-ghost chat-back" id="dm-back" title="Back">←</button>
      <span class="thread-avatar sm">${esc((name.trim()[0] || '?').toUpperCase())}</span>
      <b>${esc(name)}</b>
    </div>
    <div id="dm-messages" class="chat-scroll"></div>
    <div class="chat-input">
      <button id="dm-invite" class="btn btn-sm btn-ghost" title="Invite to a game">🎮</button>
      <input id="dm-input" class="text-input" placeholder="Message ${esc(name)}…" maxlength="200" autocomplete="off">
      <button id="dm-send" class="btn btn-sm">Send</button>
    </div>`;
  document.getElementById('dm-back').addEventListener('click', closeThread);
  document.getElementById('dm-send').addEventListener('click', sendThreadMessage);
  document.getElementById('dm-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendThreadMessage(); });
  document.getElementById('dm-invite').addEventListener('click', toggleInviteMenu);
  await refreshThreadMessages();
  document.getElementById('dm-input')?.focus();
}

// Invite the current thread's partner to a live game (sent as a DM with a link).
function toggleInviteMenu() {
  const existing = document.getElementById('dm-invite-menu');
  if (existing) { existing.remove(); return; }
  const live = GAMES.filter(g => g.live);
  const menu = document.createElement('div');
  menu.id = 'dm-invite-menu';
  menu.className = 'invite-menu';
  menu.innerHTML = `<div class="invite-menu-head">Invite to play</div>` +
    live.map(g => `<button class="invite-opt" data-game="${esc(g.id)}">${esc(g.name)}</button>`).join('');
  document.querySelector('.chat-input')?.before(menu);
  menu.querySelectorAll('[data-game]').forEach(b => b.addEventListener('click', () => {
    menu.remove();
    const g = GAMES.find(x => x.id === b.dataset.game);
    if (g) sendInvite(g);
  }));
}

async function sendInvite(game) {
  if (!activeThread) return;
  const url = /^https?:/.test(game.url) ? game.url : (location.origin + '/' + game.id + '/');
  const text = `🎮 Let's play ${game.name}! ${url}`;
  try {
    await fetch(api('api/dm/' + activeThread.id), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
    });
  } catch {}
  refreshThreadMessages();
}

function closeThread() {
  activeThread = null;
  document.getElementById('messenger')?.classList.remove('has-active');
  document.querySelectorAll('.thread-item').forEach(el => el.classList.remove('active'));
  const chat = document.getElementById('messenger-chat');
  if (chat) chat.innerHTML = '<div class="messenger-empty">Select a conversation, or search for a player to start messaging.</div>';
  loadThreads();
}

async function refreshThreadMessages() {
  if (!activeThread) return;
  const box = document.getElementById('dm-messages');
  if (!box) return;
  let msgs = [];
  try { const r = await fetch(api('api/dm/' + activeThread.id)); if (r.ok) msgs = (await r.json()).messages || []; } catch {}
  box.innerHTML = msgs.map(m => `
    <div class="bubble-row ${m.from_user_id === currentUser.id ? 'mine' : ''}">
      <div class="bubble">${linkify(esc(m.text))}<span class="bubble-time">${fmtTime(m.ts)}</span></div>
    </div>`).join('');
  box.scrollTop = box.scrollHeight;
}

// Turn http(s) URLs in already-escaped text into clickable links (for invites).
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

// Short relative-ish time for messages/threads.
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((now - d) / 86400000);
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function sendThreadMessage() {
  if (!activeThread) return;
  const input = document.getElementById('dm-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    await fetch(api('api/dm/' + activeThread.id), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
    });
  } catch {}
  refreshThreadMessages();
}

// ── Admin panel (moderation) ─────────────────────────────────────────────────
function adminPanelHTML() {
  return `<div class="panel admin-panel">
    <div class="panel-head">🛡 Admin · Platform control</div>
    <div class="admin-statbar" id="admin-stats">—</div>
    <div class="panel-body admin-body">
      <div class="admin-col">
        <div class="admin-col-head">Online now <span id="admin-online-count" class="pill">0</span></div>
        <div id="admin-online" class="admin-list"></div>
      </div>
      <div class="admin-col">
        <div class="admin-col-head">Players
          <button id="admin-purge" class="btn btn-sm btn-ghost" title="Delete inactive guest accounts">Purge guests</button>
        </div>
        <div class="add-row"><input id="admin-search" class="text-input" placeholder="Search players…" autocomplete="off"></div>
        <div id="admin-players" class="admin-list"></div>
      </div>
    </div>
    <div class="admin-audit-wrap">
      <div class="admin-col-head">Recent activity</div>
      <div id="admin-audit" class="admin-log"></div>
    </div>
  </div>`;
}

function wireAdminPanel() {
  const s = document.getElementById('admin-search');
  if (s) { let t; s.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => loadAdminPlayers(s.value.trim()), 250); }); }
  document.getElementById('admin-purge')?.addEventListener('click', async () => {
    let removed = 0;
    try { const r = await fetch(api('api/admin/purge-guests'), { method: 'POST' }); if (r.ok) removed = (await r.json()).removed || 0; } catch {}
    toast('Guests purged', removed + ' inactive guest account(s) removed.');
    loadAdminOnline(); loadAdminStats();
  });
  loadAdminOnline();
  loadAdminPlayers('');
  loadAdminStats();
  loadAdminAudit();
  clearInterval(window.__adminTimer);
  window.__adminTimer = setInterval(() => { loadAdminOnline(); loadAdminStats(); }, 15000);
}

async function loadAdminStats() {
  const el = document.getElementById('admin-stats');
  if (!el) return;
  let s = {};
  try { const r = await fetch(api('api/admin/stats')); if (r.ok) s = (await r.json()).stats || {}; } catch {}
  el.textContent = `${s.accounts || 0} accounts · ${s.online || 0} online · ${s.guests || 0} guests · ${s.admins || 0} admins · ${s.banned || 0} banned`;
}

async function loadAdminAudit() {
  const box = document.getElementById('admin-audit');
  if (!box) return;
  let entries = [];
  try { const r = await fetch(api('api/admin/audit')); if (r.ok) entries = (await r.json()).entries || []; } catch {}
  box.innerHTML = entries.length ? entries.map(e => `
    <div class="log-row"><span class="log-ev">${esc(e.event)}</span><span class="log-actor">${esc(e.actor_name || '—')}</span><span class="log-time">${fmtTime(e.ts)}</span></div>`).join('')
    : '<p class="community-msg">No recent activity.</p>';
}

function adminTag(u) {
  return `${u.isAdmin ? '<span class="tag admin">admin</span>' : ''}${u.isGuest ? '<span class="tag">guest</span>' : ''}${u.isBanned ? '<span class="tag banned">banned</span>' : ''}`;
}
function adminRow(u, online) {
  let actions = '';
  if (!u.isGuest) {
    if (u.isBanned) actions += `<button class="btn btn-sm" data-unban="${esc(u.id)}">Unban</button>`;
    else if (!u.isAdmin) actions += `<button class="btn btn-sm btn-ghost" data-ban="${esc(u.id)}" data-name="${esc(u.displayName)}">Ban</button>`;
    actions += u.isAdmin
      ? `<button class="btn btn-sm btn-ghost" data-demote="${esc(u.id)}" title="Remove admin">– Admin</button>`
      : `<button class="btn btn-sm btn-ghost" data-promote="${esc(u.id)}" title="Make admin">+ Admin</button>`;
  }
  return `<div class="person admin-item">
    <span class="person-name">${online ? '<span class="status-dot on"></span>' : ''}${esc(u.displayName)} ${adminTag(u)}</span>
    <span class="person-actions">${actions}</span>
  </div>`;
}
function wireAdminRows(box) {
  box.querySelectorAll('[data-ban]').forEach(b => b.addEventListener('click', () => {
    const reason = prompt('Ban ' + b.dataset.name + ' — reason (optional):');
    if (reason === null) return;
    adminAction('ban', { userId: b.dataset.ban, reason });
  }));
  box.querySelectorAll('[data-unban]').forEach(b => b.addEventListener('click', () => adminAction('unban', { userId: b.dataset.unban })));
  box.querySelectorAll('[data-promote]').forEach(b => b.addEventListener('click', () => adminAction('set-admin', { userId: b.dataset.promote, admin: true })));
  box.querySelectorAll('[data-demote]').forEach(b => b.addEventListener('click', () => adminAction('set-admin', { userId: b.dataset.demote, admin: false })));
}

async function loadAdminOnline() {
  const box = document.getElementById('admin-online');
  if (!box) return;
  let list = [];
  try { const r = await fetch(api('api/admin/online')); if (r.ok) list = (await r.json()).online || []; } catch {}
  const cnt = document.getElementById('admin-online-count'); if (cnt) cnt.textContent = list.length;
  box.innerHTML = list.length ? list.map(u => adminRow(u, true)).join('') : '<p class="community-msg">No one online right now.</p>';
  wireAdminRows(box);
}
async function loadAdminPlayers(q) {
  const box = document.getElementById('admin-players');
  if (!box) return;
  let list = [];
  try { const r = await fetch(api('api/admin/players?q=' + encodeURIComponent(q || ''))); if (r.ok) list = (await r.json()).players || []; } catch {}
  box.innerHTML = list.length ? list.map(u => adminRow(u, false)).join('') : '<p class="community-msg">No players found.</p>';
  wireAdminRows(box);
}
async function adminAction(kind, body) {
  try {
    const r = await fetch(api('api/admin/' + kind), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); toast('Action failed', d.error || 'Try again.'); }
  } catch {}
  loadAdminOnline();
  loadAdminPlayers(document.getElementById('admin-search')?.value.trim() || '');
}

// ── Live per-game activity (ecosystem: the hub shows what's being played) ────
async function loadGameActivity() {
  for (const g of GAMES) {
    if (!g.live) continue;
    const el = document.getElementById('activity-' + g.id);
    if (!el) continue;
    try {
      const r = await fetch(`/${g.id}/api/online`);
      if (!r.ok) continue;
      const d = await r.json();
      const p = d.players || 0, games = d.games || 0;
      el.innerHTML = p > 0
        ? `<span class="live-dot"></span>${p} playing${games ? ` · ${games} in progress` : ''}`
        : '<span class="idle-dot"></span>No games running — start one!';
    } catch {}
  }
}

// ── Online count ─────────────────────────────────────────────────────────────
async function pollOnline() {
  try {
    const r = await fetch(api('api/online'));
    const d = await r.json();
    document.getElementById('online-count').textContent = d.players ?? '—';
  } catch {
    document.getElementById('online-count').textContent = '—';
  }
}

// ── Notification WebSocket (invites, DMs, friend requests) ───────────────────
function toast(title, body, href) {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<b>${title}</b>${body ? `<span>${body}</span>` : ''}` +
    (href ? ` <a href="${href}">Open</a>` : '');
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  try { ws = new WebSocket(`${proto}://${location.host}${BASE}`); }
  catch { return; }
  ws.addEventListener('message', (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case 'game_invite':
        toast('Game invite', `${msg.fromName || 'A friend'} invited you to ${msg.game || 'a game'}.`, msg.url);
        break;
      case 'dm':
        toast(`Message from ${msg.fromName || 'a friend'}`, msg.text);
        // Live-update the messages panel.
        loadThreads();
        if (activeThread && String(activeThread.id) === String(msg.fromId)) refreshThreadMessages();
        break;
      case 'friend_request':
        toast('Friend request', `${msg.from || msg.fromName || 'Someone'} wants to be friends.`);
        loadFriends();
        break;
      case 'friend_accepted':
        toast('Friend added', `${msg.name || 'Someone'} accepted your request.`);
        loadFriends();
        break;
    }
  });
  ws.addEventListener('close', () => setTimeout(connectWS, 5000));
  ws.addEventListener('error', () => { try { ws.close(); } catch {} });
}

// ── Scroll-reveal ────────────────────────────────────────────────────────────
// Sections fade/rise into place as they enter the viewport (.reveal → .in).
const revealObs = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); }
  }
}, { threshold: 0.08 }) : null;
function watchReveal(el) {
  if (!el || el.classList.contains('reveal')) return;
  if (!revealObs) return;
  el.classList.add('reveal');
  revealObs.observe(el);
}
watchReveal(document.getElementById('community'));
// The footer is injected by footer.js (deferred) — watch it once it exists.
window.addEventListener('load', () => watchReveal(document.getElementById('rg-footer')));

// ── Boot ─────────────────────────────────────────────────────────────────────
renderCatalog();
loadMe();
loadProviders();
pollOnline();
loadGameActivity();
setInterval(pollOnline, 20000);
setInterval(loadGameActivity, 15000);
connectWS();

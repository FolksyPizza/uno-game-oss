'use strict';

// Base path: served at /holdem/ in prod, root in dev. WS resolves to the mount.
const BASE = (() => {
  try {
    const src = (document.currentScript && document.currentScript.src) || '';
    if (src) return new URL(src, location.href).pathname.replace(/[^/]*$/, '');
  } catch {}
  return '/';
})();

const QUICK_CHAT = ['Hi!', 'Good game!', 'Nice hand!', 'Nice play!', 'Oops!', 'Thanks!', 'All in!', '👍', '😂'];

let ws, myId = null, myName = '', isGuest = true, lastState = null;

const $ = (id) => document.getElementById(id);
const SUIT = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function cardEl(card) {
  const el = document.createElement('div');
  if (!card) { el.className = 'card back'; return el; }
  const red = card.suit === 'h' || card.suit === 'd';
  el.className = 'card' + (red ? ' red' : '');
  el.innerHTML = `<span>${RANK[card.rank] || card.rank}</span><span>${SUIT[card.suit]}</span>`;
  return el;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}${BASE}`);
  ws.onopen = () => {
    if (autoJoinCode) { sendWs({ type: 'join', name: myName, code: autoJoinCode }); autoJoinCode = null; }
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'joined') {
      myId = m.playerId;
      $('gate').style.display = 'none';
      $('table').style.display = 'block';
      $('room-code').textContent = m.code;
      history.replaceState(null, '', `?room=${m.code}`);
    } else if (m.type === 'state') {
      lastState = m.state;
      render(m.state, m.chat);
    } else if (m.type === 'error') {
      flash(m.error);
    }
  };
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function sendWs(msg) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

// Pull the signed-in account (shared SSO cookie) so logged-in players use their
// account name automatically instead of retyping it.
async function bootAuth() {
  try {
    const r = await fetch('/auth/me');
    if (r.ok) {
      const { user } = await r.json();
      if (user && user.displayName) {
        myName = user.displayName;
        isGuest = !!user.isGuest;
        const ni = $('name-input');
        if (ni) { ni.value = user.displayName; ni.readOnly = true; ni.title = 'Signed in as ' + user.displayName; }
      }
    }
  } catch {}
}

function join() {
  const typed = $('name-input').value.trim();
  if (typed) myName = typed;   // account name is prefilled; guests type their own
  const code = $('code-input').value.trim().toUpperCase();
  sendWs({ type: 'join', name: myName, code: code || undefined });
}

function render(s, chat) {
  $('phase').textContent = s.phase === 'waiting' ? 'Waiting for players'
    : s.phase === 'showdown' ? 'Hand complete' : s.phase.toUpperCase();
  $('pot').textContent = s.pot;

  // Board
  const board = $('board');
  board.innerHTML = '';
  for (let i = 0; i < 5; i++) board.appendChild(cardEl(s.board[i] || null));

  // Detect if I'm a guest from my seat.
  const me = s.seats.find(p => p.id === myId);
  isGuest = me ? me.isGuest : true;

  // Seats
  const seats = $('seats');
  seats.innerHTML = '';
  for (const p of s.seats) {
    const li = document.createElement('li');
    li.className = 'seat' + (p.folded ? ' folded' : '') + (p.isTurn ? ' turn' : '')
      + (p.id === myId ? ' me' : '') + (p.isGuest ? ' guest' : '');
    const status = p.folded ? 'folded' : p.allIn ? 'all-in' : (p.lastAction || '');
    li.innerHTML = `
      <div class="seat-name">${p.isButton ? '🔘 ' : ''}${esc(p.name)}${!p.connected ? ' ⚫' : ''}</div>
      <div class="seat-chips">${p.chips} chips</div>
      <div class="seat-bet">${p.bet ? 'bet ' + p.bet : ''}</div>
      <div class="seat-status muted">${status}</div>`;
    seats.appendChild(li);
  }

  // My hole cards
  const hole = $('my-hole');
  hole.innerHTML = '';
  if (me && me.hole) me.hole.forEach(c => hole.appendChild(cardEl(c)));

  // Result
  const result = $('result');
  if (s.lastResult && s.phase === 'showdown') {
    result.style.display = 'block';
    const w = s.lastResult.winners.map(x => `${esc(x.name)} +${x.amount}${x.hand ? ' (' + x.hand + ')' : ''}`).join(', ');
    result.textContent = 'Winner: ' + w;
  } else {
    result.style.display = 'none';
  }

  renderControls(s, me);
  renderChat(chat);
}

function renderControls(s, me) {
  const c = $('controls');
  c.innerHTML = '';
  const canDeal = (s.phase === 'waiting' || s.phase === 'showdown')
    && s.seats.filter(p => !p.sittingOut && p.chips > 0).length >= 2;
  if (canDeal) {
    c.appendChild(btn('Deal', 'primary', () => sendWs({ type: 'deal' })));
    return;
  }
  const myTurn = me && s.toAct === myId && !me.folded && !me.allIn;
  if (!myTurn) {
    c.innerHTML = `<span class="muted">${s.toAct ? 'Waiting for other player…' : 'Waiting…'}</span>`;
    return;
  }
  const toCall = s.currentBet - me.bet;
  c.appendChild(btn('Fold', 'ghost', () => act('fold')));
  if (toCall <= 0) c.appendChild(btn('Check', '', () => act('check')));
  else c.appendChild(btn(`Call ${Math.min(toCall, me.chips)}`, '', () => act('call')));

  // Bet / raise
  const min = s.currentBet + s.minRaise;
  const wrap = document.createElement('div');
  wrap.className = 'raise-wrap';
  const input = document.createElement('input');
  input.type = 'number'; input.min = min; input.max = me.bet + me.chips; input.value = Math.min(min, me.bet + me.chips);
  wrap.appendChild(input);
  wrap.appendChild(btn(toCall > 0 ? 'Raise' : 'Bet', '', () => act(toCall > 0 ? 'raise' : 'bet', +input.value)));
  wrap.appendChild(btn('All in', 'ghost', () => act('allin')));
  c.appendChild(wrap);
}

function act(type, amount) { sendWs({ type: 'action', action: type, amount }); }

function renderChat(chat) {
  const log = $('chat-log');
  log.innerHTML = (chat || []).map(m => `<div><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('');
  log.scrollTop = log.scrollHeight;

  const row = $('chat-row');
  if (row.dataset.mode === (isGuest ? 'guest' : 'free')) return;
  row.dataset.mode = isGuest ? 'guest' : 'free';
  row.innerHTML = '';
  if (isGuest) {
    for (const phrase of QUICK_CHAT) {
      row.appendChild(btn(phrase, 'chip', () => sendWs({ type: 'chat', text: phrase })));
    }
  } else {
    const input = document.createElement('input');
    input.placeholder = 'Message…'; input.maxLength = 200;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value.trim()) { sendWs({ type: 'chat', text: input.value }); input.value = ''; }
    });
    row.appendChild(input);
  }
}

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'btn ' + (cls || '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function flash(msg) {
  const el = document.createElement('div'); el.className = 'flash'; el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2500);
}

async function pollOnline() {
  try { const r = await fetch(`${BASE}api/online`); const d = await r.json(); $('online').textContent = `${d.players} online`; } catch {}
}

// Boot
$('join-btn').addEventListener('click', join);
$('code-input').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
const preCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
if (preCode) $('code-input').value = preCode;

// Boot: resolve the account, then if we arrived on an invite link (?room=CODE)
// with a known name, drop straight into the table — no gate, no retyping.
let autoJoinCode = null;
bootAuth().then(() => {
  if (preCode && myName) autoJoinCode = preCode;
  connect();
});
pollOnline();
setInterval(pollOnline, 20000);

'use strict';

const BASE = (() => {
  try { return new URL(document.currentScript.src, location.href).pathname.replace(/[^/]*$/, ''); } catch { return '/'; }
})();
const api = p => BASE + p.replace(/^\//, '');
const $ = id => document.getElementById(id);
const QUICK_CHAT = ['Hi!', 'Good game!', 'Nice hand!', 'Nice play!', 'So close!', 'Thanks!', '👍', '😂'];
const SUIT = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
const RANK = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

let ws, myId = null, reconnectToken = null, roomCode = null, myName = '', currentUser = null;
let state = null, room = null, selectedCardId = null, chat = [], reconnecting = false;

function wsSend(message) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function screen(id) { ['lobby', 'waiting', 'game'].forEach(x => $(x).classList.toggle('hidden', x !== id)); }
function toast(message) { $('toast').textContent = message; show('toast'); clearTimeout(toast.timer); toast.timer = setTimeout(() => hide('toast'), 2600); }

function saveSession() {
  if (!roomCode || !myId) return;
  sessionStorage.setItem('gin_room', roomCode); sessionStorage.setItem('gin_pid', myId);
  sessionStorage.setItem('gin_token', reconnectToken || ''); sessionStorage.setItem('gin_name', myName);
}
function clearSession() { ['gin_room', 'gin_pid', 'gin_token', 'gin_name'].forEach(k => sessionStorage.removeItem(k)); }

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}${BASE}`);
  ws.onopen = () => {
    if (reconnecting && sessionStorage.getItem('gin_room')) {
      wsSend({ type: 'join_room', roomCode: sessionStorage.getItem('gin_room'), playerId: sessionStorage.getItem('gin_pid'), reconnectToken: sessionStorage.getItem('gin_token'), playerName: sessionStorage.getItem('gin_name') });
    }
  };
  ws.onmessage = event => { let message; try { message = JSON.parse(event.data); } catch { return; } handle(message); };
  ws.onclose = () => {
    if (roomCode) { reconnecting = true; show('reconnect'); setTimeout(connect, 2200); }
    else setTimeout(connect, 2200);
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function handle(message) {
  if (message.type === 'room_joined') {
    myId = message.playerId; reconnectToken = message.reconnectToken; roomCode = message.roomCode;
    myName = message.players.find(p => p.id === myId)?.name || myName;
    chat = message.chat || chat; room = message; saveSession();
    reconnecting = false; hide('reconnect'); renderWaiting(message);
  } else if (message.type === 'room_updated') {
    room = message;
    if (message.phase === 'waiting' || !state) renderWaiting(message);
  } else if (message.type === 'state') {
    state = message.state; roomCode = state.roomCode; saveSession(); renderGame(state);
  } else if (message.type === 'rooms_list') renderRooms(message.rooms);
  else if (message.type === 'chat_broadcast') { chat.push(message.message); renderChat(); }
  else if (message.type === 'error') toast(message.message || 'Something went wrong');
  else if (message.type === 'game_invite') toast(`${message.fromName || 'A friend'} invited you to play.`);
}

async function bootAuth() {
  try {
    const response = await fetch(api('auth/me'));
    const data = await response.json(); currentUser = data.user;
    if (currentUser) {
      myName = currentUser.displayName; $('name-input').value = myName; $('name-input').readOnly = true;
      $('account-note').textContent = `Playing as ${myName}${currentUser.isGuest ? ' (guest)' : ''}`;
    }
  } catch {}
}

function enter(type) {
  myName = $('name-input').value.trim();
  if (!myName) return toast('Enter your name first');
  const roomCodeInput = $('code-input').value.trim().toUpperCase();
  wsSend(type === 'create_room'
    ? { type, playerName: myName }
    : { type, playerName: myName, roomCode: roomCodeInput });
}

function renderWaiting(info) {
  state = null; hide('result-modal'); screen('waiting');
  $('room-code').textContent = info.roomCode || roomCode;
  $('public-toggle').checked = !!info.isPublic;
  const isHost = info.hostId === myId;
  $('host-controls').classList.toggle('hidden', !isHost);
  $('players').innerHTML = info.players.map(p => `<div class="player-row"><span class="player-avatar">${p.isBot ? '◆' : esc(p.name[0])}</span><div><strong>${esc(p.name)}</strong><div class="muted">${p.isBot ? `CPU · ${esc(p.difficulty)}` : p.id === info.hostId ? 'Host' : 'Player'}</div></div><span class="status">${p.connected ? 'Ready' : 'Offline'}${p.isBot && isHost ? ` · <button class="btn ghost small remove-bot" data-id="${p.id}">Remove</button>` : ''}</span></div>`).join('');
  const ready = info.players.length === 2 && info.players.every(p => p.connected);
  $('start-btn').disabled = !ready; $('waiting-status').textContent = ready ? 'Both seats are ready.' : 'Waiting for one more player…';
  $('bot-btn').disabled = info.players.length >= 2;
  document.querySelectorAll('.remove-bot').forEach(b => b.addEventListener('click', () => wsSend({ type: 'remove_bot', botId: b.dataset.id })));
  renderChat();
}

function renderRooms(rooms) {
  $('rooms-list').innerHTML = rooms.length ? rooms.map(r => `<div class="room-entry"><div><strong>${esc(r.code)}</strong><div class="muted">Hosted by ${esc(r.hostName)}</div></div><button class="btn small room-join" data-code="${esc(r.code)}">Join</button></div>`).join('') : '<p class="muted">No public rooms yet.</p>';
  document.querySelectorAll('.room-join').forEach(b => b.addEventListener('click', () => { $('code-input').value = b.dataset.code; enter('join_room'); }));
}

function cardMarkup(card, cls = '') {
  if (!card) return '';
  const red = ['hearts', 'diamonds'].includes(card.suit);
  return `<span class="tiny-card ${red ? 'red' : ''} ${cls}">${RANK[card.rank] || card.rank}${SUIT[card.suit]}</span>`;
}

function cardButton(card, option) {
  const red = ['hearts', 'diamonds'].includes(card.suit);
  const label = `${RANK[card.rank] || card.rank} of ${card.suit}`;
  const button = document.createElement('button');
  button.className = `playing-card${red ? ' red' : ''}${selectedCardId === card.id ? ' selected' : ''}${option?.forbidden ? ' forbidden' : ''}`;
  button.dataset.id = card.id; button.setAttribute('aria-label', label + (option?.forbidden ? ', cannot discard this turn' : ''));
  button.innerHTML = `<span>${RANK[card.rank] || card.rank}<br>${SUIT[card.suit]}</span><span class="suit-large">${SUIT[card.suit]}</span>`;
  button.addEventListener('click', () => { selectedCardId = selectedCardId === card.id ? null : card.id; renderHand(); renderActions(); });
  return button;
}

function pileCard(card) {
  const el = $('discard'); el.innerHTML = '';
  if (!card) { el.disabled = true; return; }
  const red = ['hearts', 'diamonds'].includes(card.suit); el.disabled = !state.legal.drawDiscard;
  el.style.background = '#fbf8ef'; el.style.color = red ? '#b82935' : '#15211d';
  el.innerHTML = `<b style="font:700 24px Georgia,serif">${RANK[card.rank] || card.rank}<br>${SUIT[card.suit]}</b>`;
}

function renderGame(s) {
  screen('game'); selectedCardId = s.hand.some(c => c.id === selectedCardId) ? selectedCardId : null;
  $('pause-banner').classList.toggle('hidden', s.phase !== 'paused');
  $('hand-number').textContent = s.handNumber; $('stock-count').textContent = s.stockCount;
  s.players.forEach((p, i) => {
    const el = $(`score-${i ? 'b' : 'a'}`); el.innerHTML = `<span>${esc(p.name)}${p.id === s.dealerId ? ' · D' : ''}</span><strong>${s.scores[p.id]}</strong>`;
  });
  const opponent = s.players.find(p => p.id !== myId);
  $('opponent').innerHTML = `<div class="opponent-nameplate"><span>${esc(opponent?.name || 'Opponent')}${opponent?.isBot ? ` · ${esc(opponent.difficulty)} CPU` : ''}${opponent?.id === s.dealerId ? ' · Dealer' : ''}</span><span class="mini-hand">${Array.from({ length: opponent?.cardCount || 0 }, () => '<i class="mini-card"></i>').join('')}</span>${opponent && !opponent.connected ? '<b>Offline</b>' : ''}</div>`;
  $('stock').disabled = !s.legal.drawStock; pileCard(s.discardTop); renderHand(); renderActions(); renderTurnCopy();
  $('game-log').innerHTML = s.log.slice().reverse().map(x => `<div>${esc(x)}</div>`).join(''); renderChat();
  $('end-btn').classList.toggle('hidden', !s.legal.endMatch);
  if (['hand_result', 'match_result'].includes(s.phase) && s.lastResult) renderResult(s);
  else hide('result-modal');
}

function renderHand() {
  const root = $('hand'); root.innerHTML = '';
  const optionMap = new Map((state.discardOptions || []).map(o => [o.cardId, o]));
  state.hand.forEach(card => root.appendChild(cardButton(card, optionMap.get(card.id))));
}

function renderTurnCopy() {
  const mine = state.activePlayerId === myId;
  const names = Object.fromEntries(state.players.map(p => [p.id, p.name]));
  let copy;
  if (state.phase === 'paused') copy = 'The cards are safe. Play resumes when your opponent returns.';
  else if (state.phase === 'opening_offer_non_dealer' || state.phase === 'opening_offer_dealer') copy = mine ? 'Take the opening card or pass.' : `${names[state.activePlayerId]} is considering the opening card.`;
  else if (state.phase === 'must_draw_stock') copy = mine ? 'Both players passed. Draw from stock.' : `${names[state.activePlayerId]} must draw from stock.`;
  else if (state.phase === 'draw') copy = mine ? 'Your turn — draw from stock or take the discard.' : `${names[state.activePlayerId]} is drawing.`;
  else if (state.phase === 'discard') copy = mine ? 'Choose a card to discard, or knock with 10 or less deadwood.' : `${names[state.activePlayerId]} is choosing a discard.`;
  else if (state.phase === 'hand_result') copy = 'Hand complete.';
  else copy = 'Match complete.';
  $('turn-copy').textContent = copy;
}

function renderActions() {
  const root = $('actions'); root.innerHTML = '';
  const add = (label, cls, action, disabled = false) => { const b = document.createElement('button'); b.className = `btn ${cls}`; b.textContent = label; b.disabled = disabled; b.onclick = action; root.appendChild(b); };
  if (state.legal.openingPass) add('Pass', 'ghost', () => wsSend({ type: 'opening_pass' }));
  if (state.legal.drawStock) add('Draw stock', '', () => wsSend({ type: 'draw_stock' }));
  if (state.legal.drawDiscard) add('Take discard', '', () => wsSend({ type: 'draw_discard' }));
  if (state.legal.discard) {
    const option = state.discardOptions.find(o => o.cardId === selectedCardId);
    add('Discard', '', () => wsSend({ type: 'discard', cardId: selectedCardId }), !selectedCardId || option?.forbidden);
    add(option?.canKnock ? `Knock · ${option.deadwoodValue} deadwood` : 'Knock', 'primary', () => wsSend({ type: 'knock', cardId: selectedCardId }), !option?.canKnock);
  }
  if (!root.children.length && !['hand_result', 'match_result'].includes(state.phase)) root.innerHTML = '<span class="muted">Waiting for your opponent…</span>';
}

function renderSolution(id, result) {
  const p = state.players.find(x => x.id === id); const sol = result.solutions[id];
  const melds = sol.melds.map(m => `<div class="meld-row">${m.cards.map(c => cardMarkup(c)).join('')}</div>`).join('') || '<div class="muted">No melds</div>';
  const layoffs = (sol.layoffs || []).length ? `<div class="deadwood">Layoffs: ${sol.layoffs.map(x => cardMarkup(x.card)).join(' ')}</div>` : '';
  return `<div class="reveal"><h3>${esc(p.name)}</h3>${melds}${layoffs}<div class="deadwood">Deadwood · ${sol.deadwoodValue}<div class="meld-row">${sol.deadwood.map(c => cardMarkup(c)).join('')}</div></div></div>`;
}

function renderResult(s) {
  const r = s.lastResult; const winner = s.players.find(p => p.id === r.winnerId);
  const title = r.type === 'draw' ? 'The hand is a draw' : r.type === 'gin' ? `${winner.name} goes gin` : r.type === 'undercut' ? `${winner.name} undercuts` : `${winner.name} wins the knock`;
  $('result-title').textContent = s.phase === 'match_result' ? `${s.players.find(p => p.id === s.winnerId).name} wins the match` : title;
  $('result-summary').textContent = r.type === 'draw' ? 'Only two stock cards remained, so no points were scored.' : `${title}. ${winner.name} scores ${r.points} point${r.points === 1 ? '' : 's'}.`;
  $('revealed-hands').innerHTML = s.players.map(p => renderSolution(p.id, r)).join('');
  if (s.phase === 'match_result') {
    const f = s.finalScores;
    $('score-breakdown').innerHTML = `<strong>Official final score</strong>${s.players.map(p => `<div>${esc(p.name)}: ${f.handPoints[p.id]} hand points + ${f.bonuses.game[p.id]} game + ${f.bonuses.boxes[p.id]} boxes + ${f.bonuses.shutout[p.id]} shutout = <b>${f.totals[p.id]}</b></div>`).join('')}`;
  } else $('score-breakdown').innerHTML = s.players.map(p => `<span>${esc(p.name)} <b>${s.scores[p.id]}</b></span>`).join(' · ');
  $('next-hand-btn').classList.toggle('hidden', !s.legal.nextHand); $('close-result-btn').textContent = s.phase === 'match_result' ? 'Close scorecard' : 'Review table';
  show('result-modal');
}

function renderChat() {
  for (const prefix of ['', 'waiting-']) {
    const logEl = $(`${prefix}chat-log`); const controls = $(`${prefix}chat-controls`);
    if (!logEl || !controls) continue;
    logEl.innerHTML = chat.map(m => `<div><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight; controls.innerHTML = '';
    if (currentUser?.isGuest) QUICK_CHAT.forEach(text => { const b = document.createElement('button'); b.className = 'btn ghost small'; b.textContent = text; b.onclick = () => wsSend({ type: 'chat_message', text }); controls.appendChild(b); });
    else { const input = document.createElement('input'); input.placeholder = 'Message…'; input.maxLength = 200; input.onkeydown = e => { if (e.key === 'Enter' && input.value.trim()) { wsSend({ type: 'chat_message', text: input.value }); input.value = ''; } }; controls.appendChild(input); }
  }
}

async function showFriends() {
  show('friends-modal');
  try {
    const response = await fetch(api('api/friends')); if (!response.ok) throw new Error();
    const data = await response.json();
    $('friends-list').innerHTML = data.friends.length ? data.friends.map(f => `<div class="friend-row"><span>${esc(f.display_name)} ${f.online ? '· online' : ''}</span><button class="btn small invite-friend" data-id="${f.id}">Invite</button></div>`).join('') : '<p class="muted">No friends to invite yet. You can still copy the room link.</p>';
    document.querySelectorAll('.invite-friend').forEach(b => b.onclick = async () => { const r = await fetch(api('api/invite'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ friendId: b.dataset.id, roomCode }) }); toast(r.ok ? 'Invite sent' : 'Could not send invite'); });
  } catch { $('friends-list').innerHTML = '<p class="muted">Sign in with a full account to invite friends directly.</p>'; }
}

$('create-btn').onclick = () => enter('create_room'); $('join-btn').onclick = () => enter('join_room');
$('code-input').onkeydown = e => { if (e.key === 'Enter') enter('join_room'); };
$('refresh-rooms').onclick = () => wsSend({ type: 'list_rooms' });
$('public-toggle').onchange = e => wsSend({ type: 'set_visibility', isPublic: e.target.checked });
$('bot-btn').onclick = () => wsSend({ type: 'add_bot', difficulty: $('bot-difficulty').value });
$('start-btn').onclick = () => wsSend({ type: 'start_match' });
$('stock').onclick = () => state?.legal.drawStock && wsSend({ type: 'draw_stock' });
$('discard').onclick = () => state?.legal.drawDiscard && wsSend({ type: 'draw_discard' });
$('next-hand-btn').onclick = () => { hide('result-modal'); wsSend({ type: 'next_hand' }); };
$('close-result-btn').onclick = () => hide('result-modal');
$('end-btn').onclick = () => { if (confirm('End this match and return to the waiting room?')) wsSend({ type: 'end_match' }); };
$('rules-btn').onclick = () => show('rules-modal'); $('friends-btn').onclick = showFriends;
$('share-btn').onclick = async () => { const url = `${location.origin}${BASE}?room=${encodeURIComponent(roomCode)}`; try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch { prompt('Copy this invite link', url); } };
$('leave-btn').onclick = () => { clearSession(); roomCode = null; location.href = BASE; };
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => hide(b.dataset.close));
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m && m.id !== 'result-modal') hide(m.id); }));

const preCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
if (preCode) $('code-input').value = preCode;
bootAuth().then(() => {
  const storedRoom = sessionStorage.getItem('gin_room');
  if (storedRoom) { reconnecting = true; roomCode = storedRoom; myName = sessionStorage.getItem('gin_name') || myName; show('reconnect'); }
  connect();
  setTimeout(() => wsSend({ type: 'list_rooms' }), 300);
  if (preCode && myName && !storedRoom) setTimeout(() => enter('join_room'), 450);
});
async function pollOnline(){try{const r=await fetch(api('api/online'));const d=await r.json();$('online').textContent=`${d.players} online · ${d.games} matches`;}catch{}}
pollOnline(); setInterval(pollOnline, 20000);

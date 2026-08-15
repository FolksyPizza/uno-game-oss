'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let ws = null;
let myPlayerId = null;
let reconnectToken = null;
let myRoomCode = null;
let myName = '';
let isHost = false;
let gameState = null;
let selectedChipVal = 25;

const BASE = location.pathname.replace(/[^/]*$/, '');
const api = (p) => BASE + p.replace(/^\//, '');

// ── DOM References ───────────────────────────────────────────────────────────
const lobbyScreen = document.getElementById('lobby');
const gameScreen = document.getElementById('game');
const nameInput = document.getElementById('name-input');
const codeInput = document.getElementById('code-input');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const refreshRoomsBtn = document.getElementById('refresh-rooms');
const roomsListEl = document.getElementById('rooms-list');
const onlineCountEl = document.getElementById('online');

// Table UI
const displayRoomCode = document.getElementById('display-room-code');
const roundNumberEl = document.getElementById('round-number');
const shoeCountEl = document.getElementById('shoe-count');
const dealerScoreEl = document.getElementById('dealer-score');
const dealerCardsEl = document.getElementById('dealer-cards');
const bannerEl = document.getElementById('banner');
const insuranceBoxEl = document.getElementById('insurance-box');
const seatsContainerEl = document.getElementById('seats-container');

// Control Deck
const bettingControlsEl = document.getElementById('betting-controls');
const actionControlsEl = document.getElementById('action-controls');
const clearBetBtn = document.getElementById('clear-bet-btn');
const topupBtn = document.getElementById('topup-btn');
const dealBtn = document.getElementById('deal-btn');
const hitBtn = document.getElementById('hit-btn');
const standBtn = document.getElementById('stand-btn');
const doubleBtn = document.getElementById('double-btn');
const splitBtn = document.getElementById('split-btn');
const surrenderBtn = document.getElementById('surrender-btn');

// Host controls & Panels
const hostControlsEl = document.getElementById('host-controls');
const addBotBtn = document.getElementById('add-bot-btn');
const publicToggle = document.getElementById('public-toggle');
const tableLogEl = document.getElementById('table-log');
const chatLogEl = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');

// Modals
const rulesBtn = document.getElementById('rules-btn');
const rulesModal = document.getElementById('rules-modal');
const inviteBtn = document.getElementById('invite-btn');
const inviteModal = document.getElementById('invite-modal');
const inviteCodeEl = document.getElementById('invite-code');
const copyLinkBtn = document.getElementById('copy-link-btn');
const leaveBtn = document.getElementById('leave-btn');
const toastEl = document.getElementById('toast');
const reconnectEl = document.getElementById('reconnect');

// ── WebSocket Connection ─────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}${location.pathname}`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    reconnectEl.classList.add('hidden');
    pollOnline();
    listRooms();

    // Check URL parameters for room code or auto-reconnect
    const params = new URLSearchParams(location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      codeInput.value = roomParam.toUpperCase();
    }

    const savedId = sessionStorage.getItem('bj_player_id');
    const savedToken = sessionStorage.getItem('bj_token');
    const savedCode = sessionStorage.getItem('bj_code');
    const savedName = sessionStorage.getItem('bj_name');

    if (savedId && savedToken && savedCode) {
      send({
        type: 'join_room',
        roomCode: savedCode,
        playerName: savedName || 'Player',
        playerId: savedId,
        reconnectToken: savedToken,
      });
    }
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleServerMessage(msg);
  });

  ws.addEventListener('close', () => {
    reconnectEl.classList.remove('hidden');
    setTimeout(connectWS, 2500);
  });

  ws.addEventListener('error', () => {
    try { ws.close(); } catch {}
  });
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// ── Message Routing ──────────────────────────────────────────────────────────
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'rooms_list':
      renderRoomsList(msg.rooms || []);
      break;

    case 'room_created':
    case 'room_joined':
    case 'reconnected':
      myPlayerId = msg.playerId;
      reconnectToken = msg.reconnectToken;
      myRoomCode = msg.roomCode;
      isHost = msg.hostId === myPlayerId;

      sessionStorage.setItem('bj_player_id', myPlayerId);
      sessionStorage.setItem('bj_token', reconnectToken);
      sessionStorage.setItem('bj_code', myRoomCode);
      sessionStorage.setItem('bj_name', myName);

      lobbyScreen.classList.add('hidden');
      gameScreen.classList.remove('hidden');
      displayRoomCode.textContent = myRoomCode;
      inviteCodeEl.textContent = myRoomCode;

      if (msg.state) renderState(msg.state);
      break;

    case 'room_updated':
      isHost = msg.hostId === myPlayerId;
      if (hostControlsEl) {
        hostControlsEl.classList.toggle('hidden', !isHost);
      }
      if (publicToggle) {
        publicToggle.checked = !!msg.isPublic;
      }
      break;

    case 'state':
      if (msg.state) renderState(msg.state);
      if (msg.chat) renderChat(msg.chat);
      break;

    case 'chat_broadcast':
      appendChatMessage(msg);
      break;

    case 'error':
      showToast(msg.message || 'An error occurred');
      break;
  }
}

// ── Rendering Functions ──────────────────────────────────────────────────────
function renderState(state) {
  gameState = state;

  roundNumberEl.textContent = state.roundNumber || 1;
  shoeCountEl.textContent = state.shoeCardsRemaining || '—';

  // Dealer Zone
  renderDealer(state.dealer, state.phase);

  // Center Felt Banner
  renderBanner(state);

  // Player Seats
  renderSeats(state.seats, state.activeSeatId, state.activeHandIndex, state.phase);

  // Control Deck
  renderControlDeck(state);

  // Log
  renderLog(state.log || []);
}

function renderDealer(dealer, phase) {
  dealerCardsEl.innerHTML = '';
  if (!dealer || !dealer.cards || dealer.cards.length === 0) {
    dealerScoreEl.classList.add('hidden');
    return;
  }

  dealer.cards.forEach((card, idx) => {
    const el = document.createElement('div');
    if (card.hidden) {
      el.className = 'card hidden-card';
    } else {
      const sym = getCardSymbol(card);
      el.className = `card ${sym.isRed ? 'red' : ''}`;
      el.innerHTML = `<span>${sym.rank}</span><span class="card-suit">${sym.symbol}</span>`;
    }
    dealerCardsEl.appendChild(el);
  });

  if (dealer.eval && dealer.eval.total > 0) {
    dealerScoreEl.classList.remove('hidden');
    dealerScoreEl.textContent = dealer.revealed ? dealer.eval.total : `${dealer.eval.total}`;
    if (dealer.eval.isBlackjack && dealer.revealed) {
      dealerScoreEl.textContent = 'Blackjack!';
      dealerScoreEl.className = 'score-badge blackjack';
    } else if (dealer.eval.isBust) {
      dealerScoreEl.textContent = `Bust (${dealer.eval.total})`;
      dealerScoreEl.className = 'score-badge bust';
    } else {
      dealerScoreEl.className = 'score-badge';
    }
  } else {
    dealerScoreEl.classList.add('hidden');
  }
}

function renderBanner(state) {
  const isBetting = state.phase === 'waiting' || state.phase === 'betting' || state.phase === 'round_result';
  const mySeat = state.seats.find(s => s.id === myPlayerId);

  if (state.phase === 'insurance') {
    bannerEl.textContent = 'Insurance Offered';
    if (mySeat?.insurance?.offered) {
      insuranceBoxEl.classList.remove('hidden');
    } else {
      insuranceBoxEl.classList.add('hidden');
    }
    return;
  }
  insuranceBoxEl.classList.add('hidden');

  if (isBetting) {
    if (mySeat && mySeat.bet > 0) {
      bannerEl.textContent = `Bet Placed: $${mySeat.bet} · Click Deal Cards to start`;
    } else {
      bannerEl.textContent = 'Select chip amount and place your bet';
    }
  } else if (state.phase === 'player_turns') {
    const activeSeat = state.seats.find(s => s.id === state.activeSeatId);
    if (activeSeat) {
      if (activeSeat.id === myPlayerId) {
        bannerEl.textContent = 'Your Turn — Hit, Stand, or Double Down';
      } else {
        bannerEl.textContent = `${activeSeat.name} is making a decision…`;
      }
    }
  } else if (state.phase === 'dealer_turn') {
    bannerEl.textContent = 'Dealer drawing cards…';
  } else if (state.phase === 'round_result' && state.roundSummary) {
    bannerEl.textContent = 'Round Complete';
  }
}

function renderSeats(seats, activeSeatId, activeHandIndex, phase) {
  seatsContainerEl.innerHTML = '';

  seats.forEach((seat, seatIdx) => {
    const isMe = seat.id === myPlayerId;
    const isTurn = seat.id === activeSeatId && phase === 'player_turns';

    const station = document.createElement('div');
    station.className = `seat-station ${isMe ? 'is-me' : ''} ${isTurn ? 'active-turn' : ''}`;

    const avatarInitial = (seat.name[0] || '?').toUpperCase();
    const avatarBadge = seat.isBot ? '🤖' : avatarInitial;

    station.innerHTML = `
      <div class="seat-avatar-wrap">
        <div class="seat-avatar">${avatarBadge}</div>
        <div class="seat-name" title="${esc(seat.name)}">${esc(seat.name)}${seat.isAdmin ? ' ★' : ''}</div>
      </div>
      <div class="seat-chips">$${seat.chips}</div>
      <div class="bet-circle">
        <span class="bet-val">${seat.bet > 0 ? `$${seat.bet}` : 'Bet'}</span>
      </div>
      <div class="seat-hands" id="seat-hands-${seat.id}"></div>
    `;

    const handsContainer = station.querySelector(`#seat-hands-${seat.id}`);
    if (seat.hands && seat.hands.length > 0) {
      seat.hands.forEach((hand, hIdx) => {
        const isHandActive = isTurn && hIdx === activeHandIndex;
        const handEl = document.createElement('div');
        handEl.className = `player-hand ${isHandActive ? 'active-hand' : ''}`;

        const cardsRow = document.createElement('div');
        cardsRow.className = 'cards-row';

        hand.cards.forEach(card => {
          const sym = getCardSymbol(card);
          const cEl = document.createElement('div');
          cEl.className = `card ${sym.isRed ? 'red' : ''}`;
          cEl.innerHTML = `<span>${sym.rank}</span><span class="card-suit">${sym.symbol}</span>`;
          cardsRow.appendChild(cEl);
        });

        handEl.appendChild(cardsRow);

        if (hand.eval && hand.eval.total > 0) {
          const scoreBadge = document.createElement('span');
          let label = `${hand.eval.total}`;
          let scoreClass = 'score-badge';

          if (hand.eval.isBlackjack) {
            label = 'Blackjack!';
            scoreClass += ' blackjack';
          } else if (hand.eval.isBust) {
            label = `Bust (${hand.eval.total})`;
            scoreClass += ' bust';
          } else if (hand.eval.isSoft) {
            label = `Soft ${hand.eval.total}`;
          }

          if (hand.result) {
            if (hand.result === 'win' || hand.result === 'blackjack') label += ' · Win!';
            else if (hand.result === 'push') label += ' · Push';
            else if (hand.result === 'surrender') label += ' · Surrender';
            else if (hand.result === 'loss') label += ' · Loss';
          }

          scoreBadge.className = scoreClass;
          scoreBadge.textContent = label;
          handEl.appendChild(scoreBadge);
        }

        handsContainer.appendChild(handEl);
      });
    }

    seatsContainerEl.appendChild(station);
  });
}

function renderControlDeck(state) {
  const isBetting = state.phase === 'waiting' || state.phase === 'betting' || state.phase === 'round_result';
  const mySeat = state.seats.find(s => s.id === myPlayerId);
  const isMyTurn = state.activeSeatId === myPlayerId && state.phase === 'player_turns';

  if (isBetting) {
    bettingControlsEl.classList.remove('hidden');
    actionControlsEl.classList.add('hidden');

    if (mySeat && mySeat.chips <= 0) {
      topupBtn.classList.remove('hidden');
    } else {
      topupBtn.classList.add('hidden');
    }

    dealBtn.disabled = !mySeat || mySeat.bet < (state.houseRules?.minBet || 5);
  } else if (state.phase === 'player_turns') {
    bettingControlsEl.classList.add('hidden');
    actionControlsEl.classList.remove('hidden');

    const actions = state.availableActions || {};
    hitBtn.disabled = !isMyTurn || !actions.canHit;
    standBtn.disabled = !isMyTurn || !actions.canStand;
    doubleBtn.disabled = !isMyTurn || !actions.canDouble;
    splitBtn.disabled = !isMyTurn || !actions.canSplit;
    surrenderBtn.disabled = !isMyTurn || !actions.canSurrender;
  } else {
    bettingControlsEl.classList.add('hidden');
    actionControlsEl.classList.add('hidden');
  }
}

function renderLog(log) {
  tableLogEl.innerHTML = log.map(e => `<div>${esc(e.text)}</div>`).join('');
  tableLogEl.scrollTop = tableLogEl.scrollHeight;
}

function renderChat(chat) {
  chatLogEl.innerHTML = chat.map(c => `<div><b>${esc(c.name)}:</b> ${esc(c.text)}</div>`).join('');
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function appendChatMessage(msg) {
  const line = document.createElement('div');
  line.innerHTML = `<b>${esc(msg.name)}:</b> ${esc(msg.text)}`;
  chatLogEl.appendChild(line);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function renderRoomsList(rooms) {
  if (!roomsListEl) return;
  if (!rooms.length) {
    roomsListEl.innerHTML = '<p class="muted">No open tables found.</p>';
    return;
  }
  roomsListEl.innerHTML = rooms.map(r => `
    <div class="room-entry">
      <div>
        <strong>${esc(r.code)}</strong>
        <span class="muted"> · ${esc(r.hostName)} (${r.playerCount}/5 players)</span>
      </div>
      <button class="btn small" data-join="${esc(r.code)}">Join</button>
    </div>
  `).join('');

  roomsListEl.querySelectorAll('[data-join]').forEach(b => {
    b.addEventListener('click', () => {
      codeInput.value = b.dataset.join;
      joinRoomAction();
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getCardSymbol(card) {
  if (!card) return { rank: '?', symbol: '?', isRed: false };
  const rank = ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[card.rank] || String(card.rank);
  const symbol = ({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' })[card.suit] || '';
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  return { rank, symbol, isRed };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), 4000);
}

function listRooms() {
  send({ type: 'list_rooms' });
}

async function pollOnline() {
  try {
    const r = await fetch(api('api/online'));
    const d = await r.json();
    if (onlineCountEl) onlineCountEl.textContent = `${d.players || 0} online`;
  } catch {}
}

// ── User Actions ─────────────────────────────────────────────────────────────
function createRoomAction() {
  const name = nameInput.value.trim() || 'Player';
  myName = name;
  send({ type: 'create_room', playerName: name, isPublic: true });
}

function joinRoomAction() {
  const name = nameInput.value.trim() || 'Player';
  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    showToast('Please enter a 5-letter table code');
    return;
  }
  myName = name;
  send({ type: 'join_room', roomCode: code, playerName: name });
}

// ── Event Handlers ───────────────────────────────────────────────────────────
createBtn?.addEventListener('click', createRoomAction);
joinBtn?.addEventListener('click', joinRoomAction);
refreshRoomsBtn?.addEventListener('click', listRooms);

// Chips Betting Buttons
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    selectedChipVal = Number(chip.dataset.val);
    const mySeat = gameState?.seats?.find(s => s.id === myPlayerId);
    const currentBet = mySeat?.bet || 0;
    const newBet = currentBet + selectedChipVal;
    send({ type: 'place_bet', amount: newBet });
  });
});

clearBetBtn?.addEventListener('click', () => {
  send({ type: 'clear_bet' });
});

topupBtn?.addEventListener('click', () => {
  send({ type: 'top_up' });
});

dealBtn?.addEventListener('click', () => {
  send({ type: 'start_round' });
});

// Playing Actions
hitBtn?.addEventListener('click', () => send({ type: 'action', action: 'hit' }));
standBtn?.addEventListener('click', () => send({ type: 'action', action: 'stand' }));
doubleBtn?.addEventListener('click', () => send({ type: 'action', action: 'double' }));
splitBtn?.addEventListener('click', () => send({ type: 'action', action: 'split' }));
surrenderBtn?.addEventListener('click', () => send({ type: 'action', action: 'surrender' }));

// Insurance
document.getElementById('insurance-yes')?.addEventListener('click', () => {
  send({ type: 'insurance', take: true });
});
document.getElementById('insurance-no')?.addEventListener('click', () => {
  send({ type: 'insurance', take: false });
});

// Host Controls
addBotBtn?.addEventListener('click', () => send({ type: 'add_bot' }));
publicToggle?.addEventListener('change', (e) => send({ type: 'set_visibility', isPublic: e.target.checked }));

// Chat
chatSend?.addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (text) {
    send({ type: 'chat_message', text });
    chatInput.value = '';
  }
});
chatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (text) {
      send({ type: 'chat_message', text });
      chatInput.value = '';
    }
  }
});

// Modals
rulesBtn?.addEventListener('click', () => rulesModal.classList.remove('hidden'));
document.querySelectorAll('[data-close]').forEach(b => {
  b.addEventListener('click', () => {
    const target = document.getElementById(b.dataset.close);
    if (target) target.classList.add('hidden');
  });
});

// Rules Tab Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const content = document.getElementById(btn.dataset.tab);
    if (content) content.classList.add('active');
  });
});

// Invite Modal & Link Copy
inviteBtn?.addEventListener('click', () => {
  inviteModal.classList.remove('hidden');
  loadFriendsList();
});
copyLinkBtn?.addEventListener('click', () => {
  const url = `${location.origin}/blackjack/?room=${myRoomCode}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Table invite link copied to clipboard!');
  });
});

async function loadFriendsList() {
  const listEl = document.getElementById('friends-list');
  if (!listEl) return;
  try {
    const r = await fetch('/api/friends');
    if (!r.ok) {
      listEl.innerHTML = '<p class="muted">Sign in to invite friends directly.</p>';
      return;
    }
    const d = await r.json();
    const friends = d.friends || [];
    if (!friends.length) {
      listEl.innerHTML = '<p class="muted">No friends online.</p>';
      return;
    }
    listEl.innerHTML = friends.map(f => `
      <div class="friend-row">
        <span>${esc(f.display_name)}</span>
        <button class="btn small" data-invite-friend="${esc(f.id)}">Invite</button>
      </div>
    `).join('');

    listEl.querySelectorAll('[data-invite-friend]').forEach(b => {
      b.addEventListener('click', async () => {
        try {
          await fetch('/api/invite', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ friendId: b.dataset.inviteFriend, roomCode: myRoomCode }),
          });
          b.disabled = true;
          b.textContent = 'Invited';
        } catch {}
      });
    });
  } catch {
    listEl.innerHTML = '<p class="muted">Could not load friends list.</p>';
  }
}

leaveBtn?.addEventListener('click', () => {
  if (confirm('Leave this Blackjack table?')) {
    send({ type: 'leave_room' });
    sessionStorage.removeItem('bj_player_id');
    sessionStorage.removeItem('bj_token');
    sessionStorage.removeItem('bj_code');
    location.reload();
  }
});

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || !gameState) return;
  const isMyTurn = gameState.activeSeatId === myPlayerId && gameState.phase === 'player_turns';
  const isBetting = gameState.phase === 'waiting' || gameState.phase === 'betting' || gameState.phase === 'round_result';

  if (isMyTurn) {
    if (e.key === 'h' || e.key === 'H') { hitBtn?.click(); }
    else if (e.key === 's' || e.key === 'S') { standBtn?.click(); }
    else if (e.key === 'd' || e.key === 'D') { doubleBtn?.click(); }
    else if (e.key === 'p' || e.key === 'P') { splitBtn?.click(); }
    else if (e.key === 'r' || e.key === 'R') { surrenderBtn?.click(); }
  } else if (isBetting) {
    if (e.key === ' ' || e.key === 'Enter') {
      if (!dealBtn.disabled) dealBtn?.click();
    }
  }
});

// ── Boot ─────────────────────────────────────────────────────────────────────
connectWS();
setInterval(pollOnline, 20000);
setInterval(listRooms, 15000);

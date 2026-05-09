'use strict';

// ── State ────────────────────────────────────────────────────────
let ws;
let myPlayerId    = null;
let myRoomCode    = null;
let myPlayerName  = null;
let isHost        = false;
let currentState  = null;
let currentScreen = 'lobby';
let reconnecting  = false;
let currentHouseRules = {};
let chatMessages  = [];
let chatUnread    = 0;
let activeChatTab = 'activity';

// ── WebSocket ────────────────────────────────────────────────────
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    if (reconnecting) hideReconnectBanner();
    tryReconnect();
  };

  ws.onmessage = e => handleServerMessage(JSON.parse(e.data));

  ws.onclose = () => {
    if (myPlayerId) {
      saveSession();
      showReconnectBanner();
      reconnecting = true;
    }
    setTimeout(connect, 2500);
  };

  ws.onerror = () => ws.close();
}

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── Session persistence ──────────────────────────────────────────
function saveSession() {
  if (myPlayerName) sessionStorage.setItem('uno_name', myPlayerName);
  if (myRoomCode)   sessionStorage.setItem('uno_code', myRoomCode);
  if (myPlayerId)   sessionStorage.setItem('uno_pid',  myPlayerId);
}

function clearSession() {
  sessionStorage.removeItem('uno_name');
  sessionStorage.removeItem('uno_code');
  sessionStorage.removeItem('uno_pid');
}

function tryReconnect() {
  const name = sessionStorage.getItem('uno_name');
  const code = sessionStorage.getItem('uno_code');
  const pid  = sessionStorage.getItem('uno_pid');
  if (name && code && !myPlayerId) {
    myPlayerName = name;
    myRoomCode   = code;
    wsSend({ type: 'join_room', playerName: name, roomCode: code, playerId: pid });
  }
}

// ── Reconnect banner ─────────────────────────────────────────────
function showReconnectBanner() {
  document.getElementById('reconnect-banner').style.display = 'flex';
}
function hideReconnectBanner() {
  document.getElementById('reconnect-banner').style.display = 'none';
  reconnecting = false;
}

// ── Screen helpers ───────────────────────────────────────────────
function showScreen(id) {
  ['lobby-screen', 'waiting-screen', 'game-screen'].forEach(s => {
    document.getElementById(s).style.display = s === id ? '' : 'none';
  });
  currentScreen = id;
}

function showToast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' error' : '');
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 3500);
}

function showModal(id)  { document.getElementById(id).style.display = 'flex'; }
function hideModal(id)  { document.getElementById(id).style.display = 'none'; }

// ── Server message handler ───────────────────────────────────────
function handleServerMessage(msg) {
  switch (msg.type) {

    case 'room_created': {
      myPlayerId = msg.playerId;
      myRoomCode = msg.roomCode;
      isHost     = true;
      currentHouseRules = msg.houseRules || {};
      chatMessages = [];
      if (msg.chatHistory) loadChatHistory(msg.chatHistory);
      saveSession();
      showScreen('waiting-screen');
      renderWaiting(msg.players, msg.hostId, msg.roomCode, msg.houseRules);
      break;
    }

    case 'room_joined': {
      myPlayerId = msg.playerId;
      myRoomCode = msg.roomCode;
      isHost     = msg.hostId === msg.playerId;
      currentHouseRules = msg.houseRules || {};
      if (msg.chatHistory) loadChatHistory(msg.chatHistory);
      saveSession();
      hideReconnectBanner();
      showScreen('waiting-screen');
      renderWaiting(msg.players, msg.hostId, msg.roomCode, msg.houseRules);
      if (reconnecting) showToast('Reconnected to room!');
      reconnecting = false;
      break;
    }

    case 'room_updated': {
      isHost = msg.hostId === myPlayerId;
      currentHouseRules = msg.houseRules || {};
      if (currentScreen === 'game-screen') {
        showScreen('waiting-screen');
      }
      renderWaiting(msg.players, msg.hostId, myRoomCode, msg.houseRules);
      break;
    }

    case 'game_started': {
      chatMessages = [];
      chatUnread = 0;
      activeChatTab = 'activity';
      switchTab('activity');
      showScreen('game-screen');
      document.getElementById('game-room-code').textContent = myRoomCode;
      break;
    }

    case 'game_state_update': {
      currentState = msg;
      hideReconnectBanner();
      if (currentScreen !== 'game-screen') {
        showScreen('game-screen');
        document.getElementById('game-room-code').textContent = myRoomCode;
        if (reconnecting) showToast('Reconnected — back in the game!');
        reconnecting = false;
      }
      renderGameState(msg);
      break;
    }

    case 'choose_color_prompt': {
      showModal('color-modal');
      break;
    }

    case 'game_over': {
      showGameOver(msg.winnerName, msg.winnerId === myPlayerId);
      break;
    }

    case 'chat_broadcast': {
      appendChatMessage(msg.name, msg.text, msg.ts);
      if (currentScreen === 'game-screen' && activeChatTab !== 'chat') {
        chatUnread++;
        updateChatUnread();
      }
      break;
    }

    case 'error': {
      showToast(msg.message, true);
      if (!myPlayerId) {
        clearSession();
        hideReconnectBanner();
        reconnecting = false;
        showScreen('lobby-screen');
      }
      break;
    }
  }
}

// ── Waiting Room ─────────────────────────────────────────────────
function renderWaiting(players, hostId, code, houseRules) {
  document.getElementById('room-code-text').textContent = code || '----';
  document.getElementById('player-count').textContent   = players.length;

  const list = document.getElementById('player-list');
  list.innerHTML = '';
  players.forEach(p => {
    const item = document.createElement('div');
    item.className = 'player-item';
    const initial = (p.name[0] || '?').toUpperCase();

    const avatarClass = p.isBot ? 'player-avatar bot-avatar' : 'player-avatar';
    const avatarContent = p.isBot ? '🤖' : initial;
    item.innerHTML = `<div class="${avatarClass}">${avatarContent}</div><span>${escHtml(p.name)}</span>`;

    if (p.id === hostId && !p.isBot) {
      const b = document.createElement('span');
      b.className = 'host-badge';
      b.textContent = 'Host';
      item.appendChild(b);
    } else if (p.id === myPlayerId) {
      const b = document.createElement('span');
      b.className = 'you-badge';
      b.textContent = 'You';
      item.appendChild(b);
    } else if (p.isBot && isHost) {
      const wrap = document.createElement('span');
      wrap.className = 'bot-badge';
      wrap.innerHTML = `CPU <button class="remove-bot-btn" data-id="${p.id}" title="Remove bot">✕</button>`;
      item.appendChild(wrap);
    } else if (p.isBot) {
      const b = document.createElement('span');
      b.className = 'bot-badge';
      b.textContent = 'CPU';
      item.appendChild(b);
    }
    list.appendChild(item);
  });

  // Remove-bot buttons
  list.querySelectorAll('.remove-bot-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      wsSend({ type: 'remove_bot', botId: btn.dataset.id });
    });
  });

  const startBtn = document.getElementById('start-btn');
  startBtn.disabled = !isHost || players.length < 2;

  const addBotBtn = document.getElementById('add-bot-btn');
  addBotBtn.style.display = isHost ? 'inline-flex' : 'none';
  addBotBtn.disabled = players.length >= 8;

  const status = document.getElementById('waiting-status');
  if (isHost) {
    status.textContent = players.length < 2
      ? 'Add a bot or wait for another player to join…'
      : 'Ready! Click Start when everyone has joined.';
  } else {
    status.textContent = 'Waiting for the host to start the game…';
  }

  renderHouseRules(houseRules || {});
}

function renderHouseRules(rules) {
  const hostSection = document.getElementById('house-rules-host');
  const viewSection = document.getElementById('active-rules-display');

  if (isHost) {
    hostSection.style.display = 'block';
    viewSection.style.display = 'none';

    // Update toggles to match current rules (without triggering change events)
    document.querySelectorAll('.hr-toggle').forEach(toggle => {
      const rule = toggle.dataset.rule;
      if (rule in rules) toggle.checked = rules[rule];
    });
  } else {
    hostSection.style.display = 'none';
    const ruleLabels = {
      stackDrawCards: 'Stack Draw Cards',
      drawUntilMatch: 'Draw Until Match',
      forcePlay: 'Force Play',
      sevenO: 'Seven-O Rules',
    };
    const active = Object.entries(rules).filter(([, v]) => v);
    if (active.length > 0) {
      viewSection.style.display = 'flex';
      viewSection.innerHTML = active.map(([k]) =>
        `<span class="rule-badge">${ruleLabels[k] || k}</span>`
      ).join('');
    } else {
      viewSection.style.display = 'block';
      viewSection.innerHTML = '<span class="rule-badge-none">No house rules active</span>';
    }
  }
}

// ── Game State Rendering ─────────────────────────────────────────
function renderGameState(state) {
  const isMyTurn      = state.currentPlayerId === myPlayerId;
  const isColorChoice = state.pendingColorChoice && state.pendingColorPlayerId === myPlayerId;
  const hasDrawn      = state.drawnCardPlayerId === myPlayerId;
  const pendingDraw   = state.pendingDraw || 0;

  // Update house rules for game screen badges
  if (state.houseRules) renderGameRuleBadges(state.houseRules);

  // Turn banner
  const banner = document.getElementById('turn-banner');
  if (isMyTurn) {
    if (isColorChoice) {
      banner.textContent = 'Choose a color';
    } else if (state.pendingSevenSwap && state.pendingSevenSwapPlayerId === myPlayerId) {
      banner.textContent = '🔄 Pick a swap target';
    } else {
      banner.textContent = '⚡ Your Turn!';
    }
    banner.classList.add('your-turn');
  } else {
    const opp = state.opponents.find(o => o.id === state.currentPlayerId);
    banner.textContent = opp ? `${opp.name}'s turn` : '…';
    banner.classList.remove('your-turn');
  }

  // Direction
  const dirEl = document.getElementById('direction-indicator');
  dirEl.textContent = state.direction === 1 ? '↻' : '↺';
  dirEl.title = state.direction === 1 ? 'Clockwise' : 'Counter-clockwise';

  // Pending draw badge
  const pendingBadge = document.getElementById('pending-draw-badge');
  if (pendingDraw > 0) {
    pendingBadge.style.display = 'block';
    pendingBadge.textContent = `Stack: +${pendingDraw}`;
  } else {
    pendingBadge.style.display = 'none';
  }

  renderOpponents(state);

  // Discard pile
  const discardEl = document.getElementById('discard-pile');
  discardEl.innerHTML = '';
  if (state.topCard) {
    discardEl.appendChild(buildCard(state.topCard, state.topCardEffectiveColor, { clickable: false }));
  }

  // Draw pile
  document.getElementById('draw-count').textContent = state.drawPileCount;
  const drawBtn = document.getElementById('draw-pile-btn');
  const canDraw = isMyTurn && !hasDrawn && !state.pendingColorChoice && !state.pendingSevenSwap;
  drawBtn.style.opacity = canDraw ? '1' : '0.6';
  drawBtn.style.cursor  = canDraw ? 'pointer' : 'default';

  // UNO / Pass buttons
  const unoBtn  = document.getElementById('uno-btn');
  const passBtn = document.getElementById('pass-btn');
  unoBtn.style.display  = (state.hand.length === 1 && !state.saidUno) ? 'flex' : 'none';
  passBtn.style.display = hasDrawn ? 'flex' : 'none';

  renderHand(state, isMyTurn, hasDrawn, pendingDraw);

  // Activity log
  const log = document.getElementById('activity-log');
  log.innerHTML = state.log.map(e => `<div class="log-entry">${escHtml(e)}</div>`).join('');
  log.scrollTop = log.scrollHeight;

  document.getElementById('hand-count').textContent = state.hand.length;

  // Seven-swap modal
  if (state.pendingSevenSwap && state.pendingSevenSwapPlayerId === myPlayerId) {
    renderSevenSwapModal(state.opponents);
  }
}

function renderGameRuleBadges(rules) {
  const container = document.getElementById('active-rules-badges');
  if (!container) return;
  const short = { stackDrawCards: '+2', drawUntilMatch: '∞Draw', forcePlay: 'ForcePlay', sevenO: '7-0' };
  container.innerHTML = Object.entries(rules)
    .filter(([, v]) => v)
    .map(([k]) => `<span class="header-rule-badge">${short[k] || k}</span>`)
    .join('');
}

function renderOpponents(state) {
  const panel = document.getElementById('opponents-panel');
  panel.innerHTML = '';
  state.opponents.forEach(opp => {
    const card = document.createElement('div');
    card.className = 'opponent-card'
      + (opp.id === state.currentPlayerId ? ' active-player' : '')
      + (!opp.isConnected ? ' disconnected' : '');

    const shown     = Math.min(opp.cardCount, 7);
    const miniCards = Array.from({ length: shown }, () => '<div class="mini-card"></div>').join('');
    const catchBtn  = (opp.cardCount === 1 && !opp.saidUno && opp.isConnected)
      ? `<button class="catch-btn" data-id="${opp.id}">Catch!</button>` : '';
    const dcBadge  = opp.isConnected ? '' : '<div class="dc-badge">disconnected</div>';
    const unoBadge = opp.saidUno ? '<span class="uno-badge">UNO</span>' : '';
    const botMark  = opp.isBot ? '<span class="bot-indicator">🤖</span>' : '';

    card.innerHTML = `
      <div class="opponent-info">
        <div class="opponent-name">${escHtml(opp.name)}${botMark}</div>
        <div class="opponent-cards-row">
          ${miniCards}
          <span class="card-count-badge">${opp.cardCount > 7 ? '+' + (opp.cardCount - 7) + ' ' : ''}${opp.cardCount}🃏</span>
        </div>
        ${dcBadge}
      </div>
      ${unoBadge}
      ${catchBtn}
    `;
    panel.appendChild(card);
  });

  panel.querySelectorAll('.catch-btn').forEach(btn => {
    btn.addEventListener('click', () => wsSend({ type: 'catch_uno', targetPlayerId: btn.dataset.id }));
  });
}

function renderHand(state, isMyTurn, hasDrawn, pendingDraw) {
  const area = document.getElementById('hand-area');
  area.innerHTML = '';
  const pendingDrawType = pendingDraw > 0 ? 'draw_two' : null;

  state.hand.forEach((card, idx) => {
    const isDrawnCard = hasDrawn && idx === state.hand.length - 1;
    const playable = isMyTurn
      && !state.pendingColorChoice
      && !state.pendingSevenSwap
      && (hasDrawn ? isDrawnCard : true)
      && isCardPlayable(card, state, pendingDrawType);

    const el = buildCard(card, null, { clickable: playable });
    el.dataset.index = idx;

    if (isMyTurn && !state.pendingColorChoice && !state.pendingSevenSwap) {
      if (playable) {
        el.classList.add('playable');
        if (isDrawnCard) el.classList.add('drawn-card');
        el.addEventListener('click', () => wsSend({ type: 'play_card', cardIndex: idx }));
      } else {
        el.classList.add('not-playable');
        if (isDrawnCard) el.classList.add('drawn-card');
      }
    } else if (isDrawnCard) {
      el.classList.add('drawn-card');
    }

    area.appendChild(el);
  });
}

// ── Seven-Swap Modal ─────────────────────────────────────────────
function renderSevenSwapModal(opponents) {
  const list = document.getElementById('seven-swap-list');
  list.innerHTML = '';
  opponents.filter(o => o.isConnected).forEach(opp => {
    const btn = document.createElement('button');
    btn.className = 'swap-target-btn';
    btn.innerHTML = `
      <div>
        <div>${escHtml(opp.name)}${opp.isBot ? ' 🤖' : ''}</div>
        <div class="swap-target-info">${opp.cardCount} card${opp.cardCount !== 1 ? 's' : ''}</div>
      </div>
    `;
    btn.addEventListener('click', () => {
      hideModal('seven-modal');
      wsSend({ type: 'seven_swap_target', targetPlayerId: opp.id });
    });
    list.appendChild(btn);
  });
  showModal('seven-modal');
}

// ── Card Builder ─────────────────────────────────────────────────
function buildCard(card, overrideColor, { clickable = true } = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.type = card.type;

  const displayColor = overrideColor || card.color;
  el.classList.add(displayColor === 'wild' ? 'wild' : displayColor);

  const { sym, corner } = cardSymbols(card);
  el.innerHTML = `
    <span class="card-corner-tl">${corner}</span>
    <div class="card-inner"><span class="card-center-sym">${sym}</span></div>
    <span class="card-corner-br">${corner}</span>
  `;

  if (!clickable) el.style.cursor = 'default';
  return el;
}

function cardSymbols(card) {
  switch (card.type) {
    case 'number':         return { sym: card.value,  corner: card.value };
    case 'skip':           return { sym: '⊘',          corner: '⊘' };
    case 'reverse':        return { sym: '↺',          corner: '↺' };
    case 'draw_two':       return { sym: '+2',         corner: '+2' };
    case 'wild':           return { sym: '★',          corner: '★' };
    case 'wild_draw_four': return { sym: '+4',         corner: '+4' };
    default:               return { sym: '?',          corner: '?' };
  }
}

function isCardPlayable(card, state, pendingDrawType = null) {
  const { topCard, topCardEffectiveColor, hand } = state;
  if (!topCard || topCardEffectiveColor == null) return false;

  if (pendingDrawType === 'draw_two') return card.type === 'draw_two';

  if (card.type === 'wild') return true;
  if (card.type === 'wild_draw_four') {
    return !hand.some(
      c => c.color === topCardEffectiveColor && c.type !== 'wild' && c.type !== 'wild_draw_four'
    );
  }
  if (card.color === topCardEffectiveColor) return true;
  if (card.type !== 'number' && card.type === topCard.type) return true;
  if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) return true;
  return false;
}

// ── Game Over ────────────────────────────────────────────────────
function showGameOver(winnerName, isMe) {
  document.getElementById('gameover-text').innerHTML =
    isMe ? '🏆 You win!' : `${escHtml(winnerName)} wins!`;
  showModal('gameover-overlay');
  requestAnimationFrame(() => {
    document.getElementById('gameover-bar').style.width = '100%';
  });
  setTimeout(() => hideModal('gameover-overlay'), 5200);
}

// ── Chat ─────────────────────────────────────────────────────────
function loadChatHistory(history) {
  chatMessages = [];
  const wlog = document.getElementById('waiting-chat-log');
  const glog = document.getElementById('game-chat-log');
  if (wlog) wlog.innerHTML = '';
  if (glog) glog.innerHTML = '';
  (history || []).forEach(m => appendChatMessage(m.name, m.text, m.ts, true));
}

function appendChatMessage(name, text, ts, silent = false) {
  chatMessages.push({ name, text, ts });
  const isMe = name === myPlayerName;
  const html = `<div class="chat-msg">
    <span class="chat-msg-name ${isMe ? 'is-me' : ''}">${escHtml(name)}</span>
    <span class="chat-msg-text">${escHtml(text)}</span>
  </div>`;

  const wlog = document.getElementById('waiting-chat-log');
  const glog = document.getElementById('game-chat-log');

  if (wlog && currentScreen === 'waiting-screen') {
    wlog.insertAdjacentHTML('beforeend', html);
    wlog.scrollTop = wlog.scrollHeight;
  }
  if (glog) {
    glog.insertAdjacentHTML('beforeend', html);
    if (activeChatTab === 'chat') glog.scrollTop = glog.scrollHeight;
  }
}

function sendChat(inputId) {
  const input = document.getElementById(inputId);
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  wsSend({ type: 'chat_message', text });
}

function switchTab(tab) {
  activeChatTab = tab;
  document.getElementById('tab-activity').classList.toggle('active', tab === 'activity');
  document.getElementById('tab-chat').classList.toggle('active', tab === 'chat');
  document.getElementById('activity-content').style.display = tab === 'activity' ? '' : 'none';
  document.getElementById('chat-content').style.display = tab === 'chat' ? '' : 'none';

  if (tab === 'chat') {
    chatUnread = 0;
    updateChatUnread();
    const glog = document.getElementById('game-chat-log');
    if (glog) glog.scrollTop = glog.scrollHeight;
  }
}

function updateChatUnread() {
  const badge = document.getElementById('chat-unread');
  if (chatUnread > 0) {
    badge.style.display = 'inline-flex';
    badge.textContent = chatUnread > 9 ? '9+' : chatUnread;
  } else {
    badge.style.display = 'none';
  }
}

// ── Event listeners: Lobby ───────────────────────────────────────
document.getElementById('create-btn').addEventListener('click', () => {
  const name = document.getElementById('create-name').value.trim();
  if (!name) return showToast('Enter your name', true);
  clearSession();
  myPlayerName = name;
  wsSend({ type: 'create_room', playerName: name });
});

document.getElementById('create-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('create-btn').click();
});

document.getElementById('join-btn').addEventListener('click', () => {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) return showToast('Enter your name', true);
  if (code.length !== 4) return showToast('Enter a 4-letter room code', true);
  clearSession();
  myPlayerName = name;
  myRoomCode   = code;
  wsSend({ type: 'join_room', playerName: name, roomCode: code });
});

document.getElementById('join-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('join-btn').click();
});

document.getElementById('join-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});

// ── Event listeners: Waiting Room ────────────────────────────────
document.getElementById('copy-code-btn').addEventListener('click', () => {
  const code = document.getElementById('room-code-text').textContent;
  navigator.clipboard.writeText(code).then(() => showToast('Room code copied!'));
});

document.getElementById('start-btn').addEventListener('click', () => {
  wsSend({ type: 'start_game' });
});

document.getElementById('leave-btn').addEventListener('click', () => {
  clearSession();
  myPlayerId = myRoomCode = myPlayerName = null;
  isHost = false;
  location.reload();
});

document.getElementById('add-bot-btn').addEventListener('click', () => {
  wsSend({ type: 'add_bot' });
});

// House rules toggles
document.querySelectorAll('.hr-toggle').forEach(toggle => {
  toggle.addEventListener('change', () => {
    const rule = toggle.dataset.rule;
    const rules = { ...currentHouseRules, [rule]: toggle.checked };
    currentHouseRules = rules;
    wsSend({ type: 'configure_rules', rules });
  });
});

// Waiting room chat
document.getElementById('waiting-chat-send').addEventListener('click', () => sendChat('waiting-chat-input'));
document.getElementById('waiting-chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChat('waiting-chat-input');
});

// ── Event listeners: Game ────────────────────────────────────────
document.getElementById('draw-pile-btn').addEventListener('click', () => {
  if (!currentState) return;
  const canDraw = currentState.currentPlayerId === myPlayerId
    && currentState.drawnCardPlayerId !== myPlayerId
    && !currentState.pendingColorChoice
    && !currentState.pendingSevenSwap;
  if (canDraw) wsSend({ type: 'draw_card' });
});

document.getElementById('uno-btn').addEventListener('click', () => {
  wsSend({ type: 'say_uno' });
});

document.getElementById('pass-btn').addEventListener('click', () => {
  wsSend({ type: 'pass_turn' });
});

// Log/chat tabs
document.getElementById('tab-activity').addEventListener('click', () => switchTab('activity'));
document.getElementById('tab-chat').addEventListener('click', () => switchTab('chat'));

// Game chat
document.getElementById('game-chat-send').addEventListener('click', () => sendChat('game-chat-input'));
document.getElementById('game-chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChat('game-chat-input');
});

// ── Color chooser ────────────────────────────────────────────────
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    hideModal('color-modal');
    wsSend({ type: 'choose_color', color: btn.dataset.color });
  });
});

// ── Rules modal ──────────────────────────────────────────────────
function openRules() { showModal('rules-modal'); }
document.getElementById('game-rules-btn').addEventListener('click', openRules);
document.getElementById('waiting-rules-btn').addEventListener('click', openRules);
document.getElementById('close-rules-btn').addEventListener('click', () => hideModal('rules-modal'));
document.getElementById('rules-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) hideModal('rules-modal');
});

// ── Utility ──────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ─────────────────────────────────────────────────────────
connect();

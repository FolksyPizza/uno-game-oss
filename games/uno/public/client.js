'use strict';

// ── Base path ────────────────────────────────────────────────────
// UNO may be served at the origin root (dev: localhost:5050) or mounted under a
// subpath (prod: uno.rosemont.place/uno/, later play.rosemont.place/uno/).
// BASE is the directory this script was loaded from, so game-specific requests
// and the WebSocket resolve correctly either way. Shared auth/social endpoints
// are called at the ROOT ("/auth/*", "/api/friends"...) — those are served by
// the hub at the origin root and by uno itself in standalone dev.
const BASE = (() => {
  try {
    const src = (document.currentScript && document.currentScript.src) || '';
    if (src) return new URL(src, location.href).pathname.replace(/[^/]*$/, '');
  } catch {}
  return '/';
})();

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
let pendingKickId = null;
let pendingInviteCode = null;
let lastCurrentPlayerId = null;
let isMuted = localStorage.getItem('uno_muted') === '1';
let handSortEnabled = localStorage.getItem('uno_sort') === '1';
let currentTheme = localStorage.getItem('uno_theme') || 'dark';
let turnNotify = localStorage.getItem('uno_turn_notify') !== '0';
let confirmPlay = localStorage.getItem('uno_confirm_play') === '1';
let showAnimations = localStorage.getItem('uno_animations') !== '0';
let chatNotify = localStorage.getItem('uno_chat_notify') !== '0';

function applyTheme(theme) {
  document.body.classList.remove('light', 'classic');
  if (theme === 'light') document.body.classList.add('light');
  else if (theme === 'classic') document.body.classList.add('classic');
  currentTheme = theme;
  localStorage.setItem('uno_theme', theme);
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}
applyTheme(currentTheme);

// ── WebSocket ────────────────────────────────────────────────────
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}${BASE}`);

  ws.onopen = () => {
    if (reconnecting) hideReconnectBanner();
    tryReconnect();
    // Invite-link auto-join (signed-in visitors go straight into the room).
    if (pendingAutoJoin && myPlayerName && !myPlayerId) {
      const code = pendingAutoJoin;
      pendingAutoJoin = null;
      myRoomCode = code;
      wsSend({ type: 'join_room', playerName: myPlayerName, roomCode: code });
    }
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
  if (msg && typeof msg === 'object') {
    if (msg.type === 'play_card') playSound('play');
    else if (msg.type === 'draw_card') playSound('draw');
    else if (msg.type === 'say_uno') playSound('uno');
  }
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
  const pid  = sessionStorage.getItem('uno_pid') || myPlayerId;
  if (name && code) {
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

// Defensively wipe game-screen state — call when leaving / ending / restarting a match,
// so a stuck modal or stale render can never trap the user on a "glitched" game screen.
function resetGameUI() {
  hideModal('color-modal');
  hideModal('seven-modal');
  hideModal('gameover-overlay');
  hideModal('endgame-modal');
  currentState = null;
  const ids = ['hand-area', 'opponents-panel', 'discard-pile', 'activity-log', 'game-chat-log', 'active-rules-badges'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  const drawCount = document.getElementById('draw-count'); if (drawCount) drawCount.textContent = '0';
  const handCount = document.getElementById('hand-count'); if (handCount) handCount.textContent = '';
  const turnBanner = document.getElementById('turn-banner'); if (turnBanner) turnBanner.textContent = 'Waiting…';
  const pendingBadge = document.getElementById('pending-draw-badge'); if (pendingBadge) pendingBadge.style.display = 'none';
  const unoBtn = document.getElementById('uno-btn'); if (unoBtn) unoBtn.style.display = 'none';
  const passBtn = document.getElementById('pass-btn'); if (passBtn) passBtn.style.display = 'none';
  const chatUnreadBadge = document.getElementById('chat-unread'); if (chatUnreadBadge) chatUnreadBadge.style.display = 'none';
  chatUnread = 0;
}

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
      renderWaiting(msg.players, msg.hostId, msg.roomCode, msg.houseRules, msg.isPublic);
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
      renderWaiting(msg.players, msg.hostId, msg.roomCode, msg.houseRules, msg.isPublic);
      if (reconnecting) showToast('Reconnected to room!');
      reconnecting = false;
      break;
    }

    case 'room_updated': {
      isHost = msg.hostId === myPlayerId;
      currentHouseRules = msg.houseRules || {};
      if (currentScreen === 'game-screen') {
        resetGameUI();
        showScreen('waiting-screen');
      }
      document.getElementById('end-game-btn').style.display = 'none';
      renderWaiting(msg.players, msg.hostId, myRoomCode, msg.houseRules, msg.isPublic);
      break;
    }

    case 'game_started': {
      resetGameUI();
      chatMessages = [];
      chatUnread = 0;
      activeChatTab = 'activity';
      switchTab('activity');
      showScreen('game-screen');
      document.getElementById('game-room-code').textContent = myRoomCode;
      document.getElementById('end-game-btn').style.display = isHost ? 'inline-flex' : 'none';
      break;
    }

    case 'rooms_list': {
      renderRoomsList(msg.rooms);
      break;
    }

    case 'game_state_update': {
      currentState = msg;
      hideReconnectBanner();
      if (currentScreen !== 'game-screen') {
        showScreen('game-screen');
        document.getElementById('game-room-code').textContent = myRoomCode;
        document.getElementById('end-game-btn').style.display = isHost ? 'inline-flex' : 'none';
        if (reconnecting) showToast('Reconnected — back in the game!');
        reconnecting = false;
      }
      // Clear stale prompts: if server no longer wants us to choose a color or pick a swap target,
      // hide those modals (e.g. after a disconnect/reconnect mid-prompt).
      const myColorPending = msg.pendingColorChoice && msg.pendingColorPlayerId === myPlayerId;
      const mySwapPending  = msg.pendingSevenSwap && msg.pendingSevenSwapPlayerId === myPlayerId;
      if (myColorPending) showModal('color-modal'); else hideModal('color-modal');
      if (mySwapPending)  showModal('seven-modal'); else hideModal('seven-modal');
      renderGameState(msg);
      break;
    }

    case 'choose_color_prompt': {
      showModal('color-modal');
      break;
    }

    case 'game_over': {
      playSound('win');
      showGameOver(msg.winnerName, msg.winnerId === myPlayerId);
      break;
    }

    case 'chat_broadcast': {
      appendChatMessage(msg.name, msg.text, msg.ts);
      if (currentScreen === 'game-screen' && activeChatTab !== 'chat' && chatNotify) {
        chatUnread++;
        updateChatUnread();
      }
      break;
    }

    case 'kicked': {
      clearSession();
      myPlayerId = myRoomCode = myPlayerName = null;
      isHost = false;
      hideReconnectBanner();
      reconnecting = false;
      showScreen('lobby-screen');
      showToast(msg.message || 'You were kicked from the room.', true);
      break;
    }

    case 'friend_request': {
      showToast(`${msg.from} sent you a friend request!`);
      loadFriends();
      break;
    }

    case 'friend_accepted': {
      showToast(`${msg.name} accepted your friend request!`);
      loadFriends();
      break;
    }

    case 'dm': {
      if (currentDmFriendId === msg.fromId) {
        loadDMMessages(msg.fromId);
      } else {
        showToast(`Message from ${msg.fromName}`);
      }
      loadFriends();
      break;
    }

    case 'game_invite': {
      pendingInviteCode = msg.roomCode;
      const banner = document.getElementById('invite-banner');
      document.getElementById('invite-banner-text').textContent = `${msg.fromName} invited you to a game!`;
      banner.style.display = 'flex';
      break;
    }

    case 'error': {
      showToast(msg.message, true);
      const fatal = /not found|already in progress|full|name is already taken/i.test(msg.message || '');
      if (!myPlayerId || (reconnecting && fatal)) {
        clearSession();
        myPlayerId = myRoomCode = myPlayerName = null;
        isHost = false;
        hideReconnectBanner();
        reconnecting = false;
        showScreen('lobby-screen');
      }
      break;
    }
  }
}

// ── Waiting Room ─────────────────────────────────────────────────
function renderWaiting(players, hostId, code, houseRules, isPublic = false) {
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
    const adminBadge = p.isAdmin ? '<span class="admin-tag">ADMIN</span>' : '';
    item.innerHTML = `<div class="${avatarClass}">${avatarContent}</div><span>${escHtml(p.name)}</span>${adminBadge}`;

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
      wrap.innerHTML = `CPU · ${escHtml(p.difficulty || 'medium')} <button class="remove-bot-btn" data-id="${p.id}" title="Remove bot">✕</button>`;
      item.appendChild(wrap);
    } else if (p.isBot) {
      const b = document.createElement('span');
      b.className = 'bot-badge';
      b.textContent = `CPU · ${p.difficulty || 'medium'}`;
      item.appendChild(b);
    } else if (isHost && p.id !== myPlayerId) {
      const kb = document.createElement('button');
      kb.className = 'kick-btn';
      kb.dataset.id = p.id;
      kb.dataset.name = p.name;
      kb.title = 'Kick player';
      kb.textContent = '✕';
      item.appendChild(kb);
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

  // Kick-player buttons
  list.querySelectorAll('.kick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingKickId = btn.dataset.id;
      document.getElementById('kick-player-name').textContent = btn.dataset.name;
      showModal('kick-modal');
    });
  });

  const startBtn = document.getElementById('start-btn');
  startBtn.disabled = !isHost || players.length < 2;

  const addBotWrap = document.getElementById('add-bot-wrap');
  addBotWrap.style.display = isHost ? 'inline-flex' : 'none';
  document.getElementById('add-bot-btn').disabled = players.length >= 8;

  const status = document.getElementById('waiting-status');
  if (isHost) {
    status.textContent = players.length < 2
      ? 'Add a bot or wait for another player to join…'
      : 'Ready! Click Start when everyone has joined.';
  } else {
    status.textContent = 'Waiting for the host to start the game…';
  }

  renderHouseRules(houseRules || {});

  // Room visibility toggle (host only)
  const visSection = document.getElementById('room-visibility-section');
  const visTog = document.getElementById('room-public-toggle');
  if (isHost) {
    visSection.style.display = 'block';
    visTog.onchange = null;
    visTog.checked = !!isPublic;
    visTog.onchange = () => wsSend({ type: 'set_visibility', isPublic: visTog.checked });
  } else {
    visSection.style.display = 'none';
  }
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
  const showUno = (state.hand.length === 1 && !state.saidUno);
  unoBtn.style.display = showUno ? 'flex' : 'none';
  unoBtn.classList.toggle('uno-ready', showUno);
  passBtn.style.display = hasDrawn ? 'flex' : 'none';

  if (state.currentPlayerId !== lastCurrentPlayerId) {
    if (state.currentPlayerId === myPlayerId && lastCurrentPlayerId !== null && turnNotify) {
      playSound('your-turn');
    }
    lastCurrentPlayerId = state.currentPlayerId;
  }

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

  detectAndAnimateActions(state);
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

function sortedHandIndexes(hand) {
  const colorRank = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
  const typeRank  = { number: 0, skip: 1, reverse: 2, draw_two: 3, wild: 4, wild_draw_four: 5 };
  return hand.map((c, i) => i).sort((a, b) => {
    const ca = hand[a], cb = hand[b];
    const cr = (colorRank[ca.color] ?? 9) - (colorRank[cb.color] ?? 9);
    if (cr !== 0) return cr;
    const tr = (typeRank[ca.type] ?? 9) - (typeRank[cb.type] ?? 9);
    if (tr !== 0) return tr;
    return (ca.value ?? -1) - (cb.value ?? -1);
  });
}

function renderHand(state, isMyTurn, hasDrawn, pendingDraw) {
  const area = document.getElementById('hand-area');
  area.innerHTML = '';
  const pendingDrawType = pendingDraw > 0 ? 'draw_two' : null;

  const order = handSortEnabled ? sortedHandIndexes(state.hand) : state.hand.map((_, i) => i);

  for (const idx of order) {
    const card = state.hand[idx];
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
        el.addEventListener('click', () => {
          if (confirmPlay && !confirm('Play this card?')) return;
          wsSend({ type: 'play_card', cardIndex: idx });
        });
      } else {
        el.classList.add('not-playable');
        if (isDrawnCard) el.classList.add('drawn-card');
      }
    } else if (isDrawnCard) {
      el.classList.add('drawn-card');
    }

    area.appendChild(el);
  }
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

// Guests may only send pre-chosen phrases — swap the free-text rows for chips.
const GUEST_QUICK_CHAT = ['Hi!', 'Good game!', 'Nice play!', 'Oops!', 'Thanks!', 'UNO!', '👍', '😂', '🎉'];
function applyGuestChatUI() {
  for (const rowId of ['waiting-chat-row', 'game-chat-row']) {
    const row = document.getElementById(rowId);
    if (!row) continue;
    row.classList.add('quick-chat-row');
    row.innerHTML = '';
    for (const phrase of GUEST_QUICK_CHAT) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm btn-ghost quick-chat-chip';
      b.textContent = phrase;
      b.addEventListener('click', () => wsSend({ type: 'chat_message', text: phrase }));
      row.appendChild(b);
    }
  }
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

// ── Public Rooms Browser ─────────────────────────────────────────
function renderRoomsList(roomsList) {
  const container = document.getElementById('rooms-list');
  if (!roomsList || roomsList.length === 0) {
    container.innerHTML = '<div class="rooms-empty">No rooms found.</div>';
    return;
  }
  container.innerHTML = roomsList.map(r => `
    <div class="room-entry">
      <div class="room-entry-info">
        <span class="room-entry-host">${escHtml(r.hostName)}'s room</span>
        <span class="room-entry-meta">${r.playerCount} player${r.playerCount !== 1 ? 's' : ''}${r.botCount > 0 ? ` + ${r.botCount} bot${r.botCount !== 1 ? 's' : ''}` : ''}</span>
      </div>
      <button class="btn btn-sm btn-blue join-public-btn" data-code="${r.code}">Join</button>
    </div>
  `).join('');

  container.querySelectorAll('.join-public-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      const entry = btn.closest('.room-entry');
      const hostLabel = entry?.querySelector('.room-entry-host')?.textContent || `room ${code}`;
      openPublicJoinModal(code, hostLabel);
    });
  });
}

function openPublicJoinModal(code, hostLabel) {
  const modal     = document.getElementById('public-join-modal');
  const hostSpan  = document.getElementById('public-join-host');
  const nameInput = document.getElementById('public-join-name');
  hostSpan.textContent = hostLabel;
  const prefill = (document.getElementById('join-name').value.trim()
    || document.getElementById('create-name').value.trim()
    || '');
  nameInput.value = prefill;
  nameInput.readOnly = document.getElementById('join-name').readOnly === true;
  modal.dataset.code = code;
  modal.style.display = 'flex';
  setTimeout(() => nameInput.focus(), 0);
}

function closePublicJoinModal() {
  document.getElementById('public-join-modal').style.display = 'none';
}

function submitPublicJoin() {
  const modal = document.getElementById('public-join-modal');
  const code  = modal.dataset.code;
  const name  = document.getElementById('public-join-name').value.trim();
  if (!name) return showToast('Enter your name', true);
  if (!code)  return closePublicJoinModal();
  document.getElementById('join-name').value = name;
  document.getElementById('join-code').value = code;
  clearSession();
  myPlayerName = name;
  myRoomCode   = code;
  wsSend({ type: 'join_room', playerName: name, roomCode: code });
  closePublicJoinModal();
}

// ── Event listeners: Lobby ───────────────────────────────────────
document.getElementById('create-btn').addEventListener('click', () => {
  const name = document.getElementById('create-name').value.trim();
  if (!name) return showToast('Enter your name', true);
  const isPublic = document.getElementById('create-public-toggle').checked;
  clearSession();
  myPlayerName = name;
  wsSend({ type: 'create_room', playerName: name, isPublic });
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

document.getElementById('share-link-btn').addEventListener('click', async () => {
  const code = document.getElementById('room-code-text').textContent;
  if (!code || code === '----') return;
  const url = await getShareLink(code);
  navigator.clipboard.writeText(url).then(() => showToast('Share link copied!'));
});

document.getElementById('mute-btn').addEventListener('click', () => setMuted(!isMuted));
setMuted(isMuted); // initialize button label

document.getElementById('sort-btn').addEventListener('click', () => {
  handSortEnabled = !handSortEnabled;
  localStorage.setItem('uno_sort', handSortEnabled ? '1' : '0');
  document.getElementById('sort-btn').textContent = handSortEnabled ? '⇅ Sorted' : '⇅ Sort';
  if (currentState) renderGameState(currentState);
});
document.getElementById('sort-btn').textContent = handSortEnabled ? '⇅ Sorted' : '⇅ Sort';

document.getElementById('start-btn').addEventListener('click', () => {
  wsSend({ type: 'start_game' });
});

function performLeave() {
  try { wsSend({ type: 'leave_game' }); } catch (_) {}
  resetGameUI();
  clearSession();
  myPlayerId = myRoomCode = myPlayerName = null;
  isHost = false;
  setTimeout(() => location.reload(), 80);
}

document.getElementById('leave-btn').addEventListener('click', performLeave);

document.getElementById('game-leave-btn').addEventListener('click', () => showModal('leave-game-modal'));
document.getElementById('leave-game-yes-btn').addEventListener('click', () => {
  hideModal('leave-game-modal');
  performLeave();
});
document.getElementById('leave-game-no-btn').addEventListener('click', () => hideModal('leave-game-modal'));
document.getElementById('leave-game-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) hideModal('leave-game-modal');
});

document.getElementById('add-bot-btn').addEventListener('click', () => {
  const sel = document.getElementById('bot-difficulty');
  wsSend({ type: 'add_bot', difficulty: sel ? sel.value : 'medium' });
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

// ── Public Room Join Modal ───────────────────────────────────────
document.getElementById('public-join-confirm').addEventListener('click', submitPublicJoin);
document.getElementById('public-join-cancel').addEventListener('click', closePublicJoinModal);
document.getElementById('public-join-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitPublicJoin();
  else if (e.key === 'Escape') closePublicJoinModal();
});
document.getElementById('public-join-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closePublicJoinModal();
});

// ── End Game (host) ──────────────────────────────────────────────
document.getElementById('end-game-btn').addEventListener('click', () => {
  showModal('endgame-modal');
});
document.getElementById('endgame-yes-btn').addEventListener('click', () => {
  hideModal('endgame-modal');
  wsSend({ type: 'end_game' });
});
document.getElementById('endgame-no-btn').addEventListener('click', () => hideModal('endgame-modal'));
document.getElementById('endgame-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) hideModal('endgame-modal');
});

// ── Kick Player (host) ───────────────────────────────────────────
document.getElementById('kick-yes-btn').addEventListener('click', () => {
  if (pendingKickId) {
    wsSend({ type: 'kick_player', targetId: pendingKickId });
    pendingKickId = null;
  }
  hideModal('kick-modal');
});
document.getElementById('kick-no-btn').addEventListener('click', () => {
  pendingKickId = null;
  hideModal('kick-modal');
});
document.getElementById('kick-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) { pendingKickId = null; hideModal('kick-modal'); }
});

// ── Game invite banner ───────────────────────────────────────────
document.getElementById('invite-accept-btn').addEventListener('click', () => {
  const banner = document.getElementById('invite-banner');
  banner.style.display = 'none';
  if (pendingInviteCode && myPlayerName) {
    clearSession();
    myRoomCode = pendingInviteCode;
    wsSend({ type: 'join_room', playerName: myPlayerName, roomCode: pendingInviteCode });
  }
  pendingInviteCode = null;
});
document.getElementById('invite-dismiss-btn').addEventListener('click', () => {
  document.getElementById('invite-banner').style.display = 'none';
  pendingInviteCode = null;
});

// ── Public rooms refresh ─────────────────────────────────────────
document.getElementById('refresh-rooms-btn').addEventListener('click', () => {
  document.getElementById('rooms-list').innerHTML = '<div class="rooms-empty">Loading…</div>';
  wsSend({ type: 'list_rooms' });
});

// ── Utility ──────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Sound ────────────────────────────────────────────────────────
// Audio files are optional — drop matching mp3s into public/sounds/
// to enable. Missing files are silently ignored.
const SOUND_FILES = {
  'play': '/sounds/play.mp3',
  'draw': '/sounds/draw.mp3',
  'uno':  '/sounds/uno.mp3',
  'win':  '/sounds/win.mp3',
  'your-turn': '/sounds/your-turn.mp3',
};
const audioCache = {};
function playSound(name) {
  if (isMuted) return;
  const url = SOUND_FILES[name];
  if (!url) return;
  let audio = audioCache[name];
  if (!audio) {
    audio = new Audio(url);
    audio.preload = 'auto';
    audio.volume = 0.5;
    audioCache[name] = audio;
  }
  try { audio.currentTime = 0; audio.play().catch(() => {}); } catch {}
}
function setMuted(m) {
  isMuted = m;
  localStorage.setItem('uno_muted', m ? '1' : '0');
  const btn = document.getElementById('mute-btn');
  if (btn) btn.textContent = m ? '🔇' : '🔊';
}

// ── Auth ─────────────────────────────────────────────────────────
let authedUser = null;

async function bootAuth() {
  let providers = { google: false, github: false };
  try {
    const r = await fetch('/auth/providers');
    if (r.ok) providers = await r.json();
  } catch {}

  let me = { user: null };
  try {
    const r = await fetch('/auth/me');
    if (r.ok) me = await r.json();
  } catch {}

  const section    = document.getElementById('auth-section');
  const anon       = document.getElementById('auth-anonymous');
  const loggedin   = document.getElementById('auth-loggedin');
  const googleBtn  = document.getElementById('auth-google-btn');
  const githubBtn  = document.getElementById('auth-github-btn');
  const anyEnabled = providers.google || providers.github;

  section.style.display = 'block';

  const lobbyActions = document.getElementById('lobby-actions');

  if (me.user) {
    authedUser = me.user;
    if (me.user.isGuest) applyGuestChatUI();
    const storedName = sessionStorage.getItem('uno_name');
    if (storedName && storedName !== me.user.displayName) clearSession();
    anon.style.display = 'none';
    loggedin.style.display = 'flex';
    lobbyActions.style.display = 'flex';
    document.getElementById('auth-name').textContent = me.user.displayName;
    const s = me.user.stats || {};
    document.getElementById('auth-stats').textContent =
      `${s.wins || 0} win${s.wins === 1 ? '' : 's'} / ${s.games || 0} game${s.games === 1 ? '' : 's'}`;
    const cn = document.getElementById('create-name');
    const jn = document.getElementById('join-name');
    cn.value = me.user.displayName; cn.readOnly = true; cn.title = 'Change in Settings';
    jn.value = me.user.displayName; jn.readOnly = true; jn.title = 'Change in Settings';
    myPlayerName = me.user.displayName;
  } else {
    anon.style.display = 'block';
    loggedin.style.display = 'none';
    lobbyActions.style.display = 'none';
    // Auth is served at the origin ROOT: by the Rosemont hub in production
    // (uno is mounted under /uno/, hub at /) and by uno itself in standalone dev.
    // The session cookie is host-wide, so signing in there covers the game too.
    const ret = encodeURIComponent(location.href);
    googleBtn.href = `/auth/google?return=${ret}`;
    githubBtn.href = `/auth/github?return=${ret}`;
    if (providers.google) googleBtn.style.display = 'inline-flex';
    if (providers.github) githubBtn.style.display = 'inline-flex';
    ensureGuestButton(anon);
  }
}

// Inject a "Play as guest" button into the sign-in gate (once). Creates a
// throwaway "Guest ####" session so anyone can play without an account.
function ensureGuestButton(anon) {
  if (document.getElementById('auth-guest-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'auth-guest-btn';
  btn.className = 'auth-guest-btn';
  btn.textContent = 'Play as guest';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const r = await fetch('/auth/guest', { method: 'POST' });
      if (r.ok) { location.reload(); return; }
    } catch {}
    btn.disabled = false;
    showToast('Guest mode unavailable', true);
  });
  anon.appendChild(btn);
}

document.getElementById('auth-logout-btn').addEventListener('click', async () => {
  try { await fetch('/auth/logout', { method: 'POST' }); } catch {}
  location.reload();
});

// ── Utility ──────────────────────────────────────────────────────
// (escHtml above)

// ── URL prefill (?room=ABCD) ─────────────────────────────────────
// Capture an invite-link room code. If the visitor is signed in (name known)
// boot() drops them straight into the room; otherwise we prefill + focus.
let urlRoomCode = null;
let pendingAutoJoin = null;
(function prefillFromUrl() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('room') || '').toUpperCase().slice(0, 4);
  if (code && /^[A-Z]{4}$/.test(code)) {
    urlRoomCode = code;
    document.getElementById('join-code').value = code;
    setTimeout(() => document.getElementById('join-name').focus(), 50);
  }
})();

// ── Settings Panel ──────────────────────────────────────────────
function openSettings() {
  if (authedUser) document.getElementById('settings-display-name').value = authedUser.displayName;
  document.getElementById('settings-mute-toggle').checked = isMuted;
  document.getElementById('settings-sort-toggle').checked = handSortEnabled;
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === currentTheme));
  document.getElementById('settings-turn-notify').checked = turnNotify;
  document.getElementById('settings-confirm-play').checked = confirmPlay;
  document.getElementById('settings-show-animations').checked = showAnimations;
  document.getElementById('settings-chat-notify').checked = chatNotify;
  showModal('settings-modal');
}

document.getElementById('settings-btn').addEventListener('click', openSettings);
document.getElementById('settings-close-btn').addEventListener('click', () => hideModal('settings-modal'));
document.getElementById('settings-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) hideModal('settings-modal');
});

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

document.getElementById('settings-mute-toggle').addEventListener('change', function () {
  setMuted(this.checked);
});

document.getElementById('settings-turn-notify').addEventListener('change', function () {
  turnNotify = this.checked;
  localStorage.setItem('uno_turn_notify', turnNotify ? '1' : '0');
});

document.getElementById('settings-confirm-play').addEventListener('change', function () {
  confirmPlay = this.checked;
  localStorage.setItem('uno_confirm_play', confirmPlay ? '1' : '0');
});

document.getElementById('settings-show-animations').addEventListener('change', function () {
  showAnimations = this.checked;
  localStorage.setItem('uno_animations', showAnimations ? '1' : '0');
});

document.getElementById('settings-chat-notify').addEventListener('change', function () {
  chatNotify = this.checked;
  localStorage.setItem('uno_chat_notify', chatNotify ? '1' : '0');
});

document.getElementById('settings-sort-toggle').addEventListener('change', function () {
  handSortEnabled = this.checked;
  localStorage.setItem('uno_sort', handSortEnabled ? '1' : '0');
  document.getElementById('sort-btn').textContent = handSortEnabled ? '⇅ Sorted' : '⇅ Sort';
  if (currentState) renderGameState(currentState);
});

document.getElementById('settings-save-name').addEventListener('click', async () => {
  const input = document.getElementById('settings-display-name');
  const newName = input.value.trim();
  if (!newName) return showToast('Name cannot be empty', true);

  try {
    const res = await fetch('/auth/update-name', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || 'Failed to update name', true);

    authedUser.displayName = data.displayName;
    document.getElementById('auth-name').textContent = data.displayName;
    const cn = document.getElementById('create-name');
    const jn = document.getElementById('join-name');
    cn.value = data.displayName;
    jn.value = data.displayName;
    myPlayerName = data.displayName;
    showToast('Username updated!');
  } catch {
    showToast('Failed to update name', true);
  }
});

document.getElementById('settings-display-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('settings-save-name').click();
});

// ── Room code hashing for share links ───────────────────────────
async function getShareLink(code) {
  try {
    const r = await fetch(`${BASE}api/room-hash/${code}`);
    if (r.ok) {
      const d = await r.json();
      return `${location.origin}${BASE}join/${d.hash}`;
    }
  } catch {}
  return `${location.origin}${BASE}join/${code}`;
}

// ── Friends System ──────────────────────────────────────────────
let currentDmFriendId = null;
let friendsData = { friends: [], pending: [], sent: [] };

async function loadFriends() {
  try {
    const r = await fetch('/api/friends');
    if (!r.ok) return;
    friendsData = await r.json();
    renderFriendsList();
    updateFriendsBadge();
  } catch {}
}

function updateFriendsBadge() {
  const badge = document.getElementById('friends-badge');
  const total = (friendsData.pending?.length || 0) +
    friendsData.friends.reduce((s, f) => s + (f.unread || 0), 0);
  if (total > 0) {
    badge.style.display = 'inline';
    badge.textContent = total > 9 ? '9+' : total;
  } else {
    badge.style.display = 'none';
  }
}

function renderFriendsList() {
  const reqSection = document.getElementById('friend-requests-section');
  const reqList = document.getElementById('friend-requests-list');
  const list = document.getElementById('friends-list');

  if (friendsData.pending.length > 0) {
    reqSection.style.display = 'flex';
    reqList.innerHTML = friendsData.pending.map(r => `
      <div class="friend-item">
        <div class="friend-avatar">${(r.from_name[0] || '?').toUpperCase()}</div>
        <div class="friend-info">
          <div class="friend-name">${escHtml(r.from_name)}</div>
          <div class="friend-status">wants to be friends</div>
        </div>
        <div class="friend-actions">
          <button class="btn btn-sm btn-green fr-accept" data-id="${r.from_user_id}">Accept</button>
          <button class="btn btn-sm btn-ghost fr-reject" data-id="${r.from_user_id}">Deny</button>
        </div>
      </div>
    `).join('');
    reqList.querySelectorAll('.fr-accept').forEach(b => b.addEventListener('click', async () => {
      await fetch('/api/friends/accept', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ fromUserId: b.dataset.id }) });
      loadFriends();
    }));
    reqList.querySelectorAll('.fr-reject').forEach(b => b.addEventListener('click', async () => {
      await fetch('/api/friends/reject', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ fromUserId: b.dataset.id }) });
      loadFriends();
    }));
  } else {
    reqSection.style.display = 'none';
  }

  if (friendsData.friends.length === 0) {
    list.innerHTML = '<div class="friends-empty">No friends yet. Add someone by username.</div>';
    return;
  }
  list.innerHTML = friendsData.friends.map(f => `
    <div class="friend-item">
      <div class="friend-avatar">${(f.display_name[0] || '?').toUpperCase()}</div>
      <div class="friend-info">
        <div class="friend-name">${escHtml(f.display_name)}</div>
        <div class="friend-status ${f.online ? 'is-online' : ''}">${f.online ? 'Online' : 'Offline'}</div>
      </div>
      ${f.unread ? `<span class="friend-unread">${f.unread}</span>` : ''}
      <div class="friend-actions">
        ${myRoomCode ? `<button class="btn btn-sm btn-green fr-invite" data-id="${f.id}">Invite</button>` : ''}
        <button class="btn btn-sm btn-ghost fr-dm" data-id="${f.id}" data-name="${escHtml(f.display_name)}">Message</button>
        <button class="btn btn-sm btn-ghost fr-remove" data-id="${f.id}">Remove</button>
      </div>
    </div>
  `).join('');

  // One-click: invite this friend to my current room (they get a toast + a DM link).
  list.querySelectorAll('.fr-invite').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Invited ✓';
    try {
      await fetch(`${BASE}api/invite`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ friendId: b.dataset.id, roomCode: myRoomCode }),
      });
    } catch { b.disabled = false; b.textContent = 'Invite'; }
  }));

  list.querySelectorAll('.fr-dm').forEach(b => b.addEventListener('click', () => {
    hideModal('friends-modal');
    openDM(b.dataset.id, b.dataset.name);
  }));
  list.querySelectorAll('.fr-remove').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remove this friend?')) return;
    await fetch('/api/friends/remove', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ friendId: b.dataset.id }) });
    loadFriends();
  }));
}

document.getElementById('friends-btn').addEventListener('click', () => {
  loadFriends();
  showModal('friends-modal');
});
document.getElementById('friends-close-btn').addEventListener('click', () => hideModal('friends-modal'));
document.getElementById('friends-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) hideModal('friends-modal');
});

document.getElementById('friend-add-btn').addEventListener('click', async () => {
  const input = document.getElementById('friend-add-input');
  const name = input.value.trim();
  if (!name) return;
  try {
    const r = await fetch('/api/friends/request', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ name }) });
    const d = await r.json();
    if (!r.ok) return showToast(d.error, true);
    input.value = '';
    showToast(d.status === 'accepted' ? 'Friend added!' : 'Request sent!');
    loadFriends();
  } catch { showToast('Failed to send request', true); }
});
document.getElementById('friend-add-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('friend-add-btn').click();
});

// ── DM System ───────────────────────────────────────────────────
async function openDM(friendId, friendName) {
  currentDmFriendId = friendId;
  document.getElementById('dm-friend-name').textContent = friendName;
  const inviteBtn = document.getElementById('dm-invite-btn');
  inviteBtn.style.display = myRoomCode ? 'inline-flex' : 'none';
  showModal('dm-modal');
  await loadDMMessages(friendId);
}

async function loadDMMessages(friendId) {
  const container = document.getElementById('dm-messages');
  container.innerHTML = '<div class="friends-empty">Loading...</div>';
  try {
    const r = await fetch(`/api/dm/${friendId}`);
    const d = await r.json();
    if (!d.messages.length) {
      container.innerHTML = '<div class="friends-empty">No messages yet.</div>';
      return;
    }
    container.innerHTML = d.messages.map(m => {
      const mine = m.from_user_id === authedUser.id;
      const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<div class="dm-msg ${mine ? 'dm-mine' : 'dm-theirs'}">
        ${escHtml(m.text)}
        <div class="dm-msg-meta">${time}</div>
      </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  } catch { container.innerHTML = '<div class="friends-empty">Failed to load.</div>'; }
  loadFriends();
}

document.getElementById('dm-send-btn').addEventListener('click', async () => {
  const input = document.getElementById('dm-input');
  const text = input.value.trim();
  if (!text || !currentDmFriendId) return;
  input.value = '';
  try {
    const r = await fetch(`/api/dm/${currentDmFriendId}`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ text }) });
    if (!r.ok) { const d = await r.json(); showToast(d.error, true); return; }
    await loadDMMessages(currentDmFriendId);
  } catch { showToast('Failed to send', true); }
});
document.getElementById('dm-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('dm-send-btn').click();
});
document.getElementById('dm-close-btn').addEventListener('click', () => { hideModal('dm-modal'); currentDmFriendId = null; });
document.getElementById('dm-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) { hideModal('dm-modal'); currentDmFriendId = null; }
});

document.getElementById('dm-invite-btn').addEventListener('click', async () => {
  if (!myRoomCode || !currentDmFriendId) return;
  try {
    await fetch(`${BASE}api/invite`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ friendId: currentDmFriendId, roomCode: myRoomCode }) });
    showToast('Invite sent!');
  } catch { showToast('Failed to invite', true); }
});

// ── Online Stats ────────────────────────────────────────────────
async function refreshOnlineCount() {
  try {
    const r = await fetch(`${BASE}api/online`);
    if (r.ok) {
      const data = await r.json();
      const el = document.getElementById('online-count');
      if (el) el.textContent = data.connections || 0;
    }
  } catch {}
}
setInterval(refreshOnlineCount, 15000);

// ── Card Action Animations ──────────────────────────────────────
let prevLogLen = 0;

function showCardAction(playerName, actionType, card) {
  if (!showAnimations) return;
  const overlay = document.getElementById('card-action-overlay');
  if (!overlay) return;

  const el = document.createElement('div');
  el.className = `card-action-anim anim-${actionType === 'draw' ? 'draw' : 'play'}`;

  const colorMap = { red: '#e74c3c', blue: '#2980b9', green: '#27ae60', yellow: '#f1c40f', wild: '#8e44ad' };
  const cardColor = card ? (colorMap[card.color] || '#8e44ad') : '#8e44ad';

  const label = actionType === 'draw'
    ? `${playerName} drew a card`
    : `${playerName} played`;

  el.innerHTML = `
    <div class="anim-mini-card" style="background:${cardColor}"></div>
    <span>${escHtml(label)}</span>
  `;

  const vOffset = 30 + Math.random() * 40;
  el.style.top = `${vOffset}%`;
  el.style.left = '-200px';

  overlay.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

function detectAndAnimateActions(state) {
  if (!state.log || !state.log.length) { prevLogLen = 0; return; }
  if (prevLogLen === 0) { prevLogLen = state.log.length; return; }

  const newEntries = state.log.slice(prevLogLen);
  prevLogLen = state.log.length;

  for (const entry of newEntries) {
    const playMatch = entry.match(/^(.+?) played (.+)/);
    const drawMatch = entry.match(/^(.+?) drew/);
    if (playMatch) {
      showCardAction(playMatch[1], 'play', state.topCard);
    } else if (drawMatch) {
      showCardAction(drawMatch[1], 'draw', null);
    }
  }
}

// ── Loading Screen ──────────────────────────────────────────────
// The old UNO card-fan loader was replaced by the shared Rosemont splash
// (/splash.js overlay) — just reveal the lobby underneath it.
function dismissLoading() {
  document.getElementById('lobby-screen').style.display = '';
}

// ── Boot ─────────────────────────────────────────────────────────
async function boot() {
  await bootAuth();
  // Signed-in + arrived on an invite link → auto-join once the socket opens.
  if (urlRoomCode && myPlayerName) pendingAutoJoin = urlRoomCode;
  connect();
  refreshOnlineCount();
  if (authedUser) loadFriends();
  setTimeout(dismissLoading, 800);
}
boot();

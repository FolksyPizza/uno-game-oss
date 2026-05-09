const { createDeck, shuffleDeck, dealHands, COLORS, TYPES } = require('./deck');

function ensureDrawPile(room) {
  const gs = room.gameState;
  if (gs.drawPile.length > 0) return;
  if (gs.discardPile.length <= 1) return;
  const top = gs.discardPile.pop();
  gs.drawPile = shuffleDeck(gs.discardPile);
  gs.discardPile = [top];
  gs.log.push('Draw pile reshuffled from discard');
}

function getNextPlayerIndex(room, steps = 1) {
  const gs = room.gameState;
  const order = room.playerOrder;
  let idx = gs.currentPlayerIndex;
  let count = 0;
  const maxIter = order.length * steps + order.length;
  let safety = 0;
  while (count < steps && safety < maxIter) {
    idx = (idx + gs.direction + order.length) % order.length;
    safety++;
    const player = room.players.get(order[idx]);
    if (player && player.isConnected) count++;
  }
  return idx;
}

function getNextAbsoluteIndex(room) {
  const gs = room.gameState;
  const len = room.playerOrder.length;
  return (gs.currentPlayerIndex + gs.direction + len) % len;
}

function advanceTurn(room, steps = 1) {
  room.gameState.currentPlayerIndex = getNextPlayerIndex(room, steps);
  room.gameState.drawnCardPlayerId = null;
}

function canPlayCard(card, topCard, effectiveColor, hand, pendingDrawType = null) {
  // When draw stacking is active, only the same draw card type can be played
  if (pendingDrawType === 'draw_two') return card.type === TYPES.draw_two;

  if (card.type === TYPES.wild) return true;
  if (card.type === TYPES.wild_draw_four) {
    const hasMatchingColor = hand.some(
      c => c.color === effectiveColor && c.type !== TYPES.wild && c.type !== TYPES.wild_draw_four
    );
    return !hasMatchingColor;
  }
  if (card.color === effectiveColor) return true;
  if (card.type !== TYPES.number && card.type === topCard.type) return true;
  if (card.type === TYPES.number && topCard.type === TYPES.number && card.value === topCard.value) return true;
  return false;
}

function initGame(room) {
  const deck = shuffleDeck(createDeck());
  const { hands, remaining } = dealHands(deck, room.playerOrder.length);

  room.playerOrder.forEach((playerId, idx) => {
    const player = room.players.get(playerId);
    player.hand = hands[idx];
    player.saidUno = false;
  });

  let topCard;
  do {
    topCard = remaining.pop();
    if (topCard.type === TYPES.wild_draw_four) {
      remaining.unshift(topCard);
      topCard = null;
    }
  } while (!topCard);

  room.gameState = {
    drawPile: remaining,
    discardPile: [topCard],
    currentPlayerIndex: 0,
    direction: 1,
    pendingColorChoice: false,
    pendingColorPlayerId: null,
    pendingDrawFourAmount: 0,
    topCardEffectiveColor: topCard.color === 'wild' ? null : topCard.color,
    drawnCardPlayerId: null,
    pendingDraw: 0,
    pendingSevenSwap: false,
    pendingSevenSwapPlayerId: null,
    log: [`Game started — top card: ${topCard.color} ${topCard.type}${topCard.value != null ? ' ' + topCard.value : ''}`],
    winnerId: null,
  };

  const gs = room.gameState;

  switch (topCard.type) {
    case TYPES.skip: {
      const firstPlayer = room.players.get(room.playerOrder[0]);
      gs.log.push(`${firstPlayer.name} skipped by opening card`);
      gs.currentPlayerIndex = getNextPlayerIndex(room, 1);
      break;
    }
    case TYPES.reverse: {
      gs.direction = -1;
      if (room.playerOrder.length === 2) {
        const firstPlayer = room.players.get(room.playerOrder[0]);
        gs.log.push(`${firstPlayer.name} skipped by opening Reverse`);
        gs.currentPlayerIndex = getNextPlayerIndex(room, 1);
      } else {
        gs.log.push('Direction reversed by opening card');
      }
      break;
    }
    case TYPES.draw_two: {
      const firstPlayer = room.players.get(room.playerOrder[0]);
      for (let i = 0; i < 2; i++) {
        ensureDrawPile(room);
        if (gs.drawPile.length > 0) firstPlayer.hand.push(gs.drawPile.pop());
      }
      firstPlayer.saidUno = false;
      gs.log.push(`${firstPlayer.name} draws 2 from opening card and is skipped`);
      gs.currentPlayerIndex = getNextPlayerIndex(room, 1);
      break;
    }
    case TYPES.wild: {
      gs.pendingColorChoice = true;
      gs.pendingColorPlayerId = room.playerOrder[0];
      gs.log.push('Opening Wild — first player must choose a color');
      break;
    }
  }
}

function playCard(room, playerId, cardIndex) {
  const gs = room.gameState;
  const hr = room.houseRules || {};
  const player = room.players.get(playerId);

  if (room.playerOrder[gs.currentPlayerIndex] !== playerId) throw new Error('Not your turn');
  if (gs.pendingColorChoice) throw new Error('Waiting for color choice');
  if (gs.pendingSevenSwap) throw new Error('Waiting for swap target');

  if (gs.drawnCardPlayerId === playerId && cardIndex !== player.hand.length - 1) {
    throw new Error('You can only play the drawn card or pass');
  }

  const card = player.hand[cardIndex];
  if (!card) throw new Error('Invalid card index');

  const topCard = gs.discardPile[gs.discardPile.length - 1];
  const pendingDrawType = gs.pendingDraw > 0 ? 'draw_two' : null;
  if (!canPlayCard(card, topCard, gs.topCardEffectiveColor, player.hand, pendingDrawType)) {
    throw new Error('Cannot play that card');
  }

  player.hand.splice(cardIndex, 1);
  gs.discardPile.push(card);
  gs.drawnCardPlayerId = null;
  player.saidUno = false;

  const colorLabel = card.color !== 'wild' ? card.color + ' ' : '';
  const typeLabel = card.type.replace(/_/g, ' ');
  const valueLabel = card.value != null ? ' ' + card.value : '';
  gs.log.push(`${player.name} played ${colorLabel}${typeLabel}${valueLabel}`);

  if (player.hand.length === 0) {
    gs.winnerId = playerId;
    return;
  }

  switch (card.type) {
    case TYPES.number:
      gs.topCardEffectiveColor = card.color;
      // Seven-O rule
      if (hr.sevenO && card.value === 7 && room.playerOrder.length > 1) {
        gs.pendingSevenSwap = true;
        gs.pendingSevenSwapPlayerId = playerId;
        gs.log.push(`${player.name} played 7 — must choose a player to swap hands with`);
        // Don't advance turn yet
      } else if (hr.sevenO && card.value === 0) {
        executeZeroRotate(room);
      } else {
        advanceTurn(room, 1);
      }
      break;
    case TYPES.skip:
      gs.topCardEffectiveColor = card.color;
      advanceTurn(room, 2);
      break;
    case TYPES.reverse:
      gs.topCardEffectiveColor = card.color;
      gs.direction *= -1;
      advanceTurn(room, room.playerOrder.length === 2 ? 2 : 1);
      break;
    case TYPES.draw_two: {
      gs.topCardEffectiveColor = card.color;
      if (hr.stackDrawCards) {
        gs.pendingDraw += 2;
        gs.log.push(`Draw stack: ${gs.pendingDraw} cards pending`);
        advanceTurn(room, 1);
      } else {
        const nextIdx = getNextAbsoluteIndex(room);
        const nextPlayer = room.players.get(room.playerOrder[nextIdx]);
        if (nextPlayer) {
          for (let i = 0; i < 2; i++) {
            ensureDrawPile(room);
            if (gs.drawPile.length > 0) nextPlayer.hand.push(gs.drawPile.pop());
          }
          nextPlayer.saidUno = false;
          gs.log.push(`${nextPlayer.name} draws 2 cards`);
        }
        advanceTurn(room, 2);
      }
      break;
    }
    case TYPES.wild:
      // If stacking is active and pendingDraw > 0, wild resets it (player broke the chain — server error would catch this above)
      gs.pendingDraw = 0;
      gs.pendingColorChoice = true;
      gs.pendingColorPlayerId = playerId;
      gs.pendingDrawFourAmount = 0;
      break;
    case TYPES.wild_draw_four:
      gs.pendingDraw = 0;
      gs.pendingColorChoice = true;
      gs.pendingColorPlayerId = playerId;
      gs.pendingDrawFourAmount = 4;
      break;
  }
}

function executeSevenSwap(room, playerId, targetId) {
  const gs = room.gameState;
  const player = room.players.get(playerId);
  const target = room.players.get(targetId);
  if (!player || !target) throw new Error('Invalid swap target');
  if (!gs.pendingSevenSwap || gs.pendingSevenSwapPlayerId !== playerId) {
    throw new Error('No pending swap for you');
  }

  const tmp = player.hand;
  player.hand = target.hand;
  target.hand = tmp;
  player.saidUno = false;
  target.saidUno = false;

  gs.pendingSevenSwap = false;
  gs.pendingSevenSwapPlayerId = null;
  gs.log.push(`${player.name} swapped hands with ${target.name}`);
  advanceTurn(room, 1);
}

function executeZeroRotate(room) {
  const gs = room.gameState;
  const order = room.playerOrder;
  if (order.length < 2) { advanceTurn(room, 1); return; }

  // Snapshot all hands first to avoid aliasing
  const snapshot = order.map(id => room.players.get(id).hand);

  if (gs.direction === 1) {
    // Clockwise: each player receives the hand of the previous player
    order.forEach((id, i) => {
      const fromIdx = (i - 1 + order.length) % order.length;
      room.players.get(id).hand = snapshot[fromIdx];
    });
  } else {
    // Counter-clockwise: each player receives the hand of the next player
    order.forEach((id, i) => {
      const fromIdx = (i + 1) % order.length;
      room.players.get(id).hand = snapshot[fromIdx];
    });
  }

  for (const p of room.players.values()) p.saidUno = false;
  gs.log.push('0 played — all hands rotated!');
  advanceTurn(room, 1);
}

function chooseColor(room, playerId, color) {
  const gs = room.gameState;
  if (!gs.pendingColorChoice || gs.pendingColorPlayerId !== playerId) {
    throw new Error('Not your color choice');
  }
  if (!COLORS.includes(color)) throw new Error('Invalid color');

  gs.topCardEffectiveColor = color;
  gs.pendingColorChoice = false;
  gs.pendingColorPlayerId = null;
  gs.log.push(`${room.players.get(playerId).name} chose ${color}`);

  if (gs.pendingDrawFourAmount > 0) {
    const nextIdx = getNextAbsoluteIndex(room);
    const nextPlayer = room.players.get(room.playerOrder[nextIdx]);
    if (nextPlayer) {
      const amount = gs.pendingDrawFourAmount;
      for (let i = 0; i < amount; i++) {
        ensureDrawPile(room);
        if (gs.drawPile.length > 0) nextPlayer.hand.push(gs.drawPile.pop());
      }
      nextPlayer.saidUno = false;
      gs.log.push(`${nextPlayer.name} draws ${amount} cards`);
    }
    gs.pendingDrawFourAmount = 0;
    advanceTurn(room, 2);
  } else {
    advanceTurn(room, 1);
  }
}

function autoChooseColor(room) {
  const gs = room.gameState;
  if (!gs.pendingColorChoice) return;

  const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
  for (const p of room.players.values()) {
    for (const c of p.hand) {
      if (counts[c.color] !== undefined) counts[c.color]++;
    }
  }
  const color = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || 'red';

  gs.topCardEffectiveColor = color;
  gs.pendingColorChoice = false;
  gs.pendingColorPlayerId = null;
  gs.log.push(`Color auto-set to ${color} (player disconnected)`);

  if (gs.pendingDrawFourAmount > 0) {
    const nextIdx = getNextAbsoluteIndex(room);
    const nextPlayer = room.players.get(room.playerOrder[nextIdx]);
    if (nextPlayer) {
      const amount = gs.pendingDrawFourAmount;
      for (let i = 0; i < amount; i++) {
        ensureDrawPile(room);
        if (gs.drawPile.length > 0) nextPlayer.hand.push(gs.drawPile.pop());
      }
      nextPlayer.saidUno = false;
      gs.log.push(`${nextPlayer.name} draws ${amount} cards`);
    }
    gs.pendingDrawFourAmount = 0;
    advanceTurn(room, 2);
  } else {
    advanceTurn(room, 1);
  }
}

function drawCard(room, playerId) {
  const gs = room.gameState;
  const hr = room.houseRules || {};
  if (room.playerOrder[gs.currentPlayerIndex] !== playerId) throw new Error('Not your turn');
  if (gs.pendingColorChoice) throw new Error('Waiting for color choice');
  if (gs.drawnCardPlayerId === playerId) throw new Error('Already drew — play it or pass');

  const player = room.players.get(playerId);
  const topCard = gs.discardPile[gs.discardPile.length - 1];

  // Stacking rule: player must take all pending draw cards and their turn ends
  if (hr.stackDrawCards && gs.pendingDraw > 0) {
    const amount = gs.pendingDraw;
    for (let i = 0; i < amount; i++) {
      ensureDrawPile(room);
      if (gs.drawPile.length > 0) player.hand.push(gs.drawPile.pop());
    }
    player.saidUno = false;
    gs.pendingDraw = 0;
    gs.log.push(`${player.name} draws ${amount} cards (stacked)`);
    advanceTurn(room, 1);
    return;
  }

  // Force play rule: must play if possible
  if (hr.forcePlay) {
    const hasPlayable = player.hand.some(c => canPlayCard(c, topCard, gs.topCardEffectiveColor, player.hand));
    if (hasPlayable) throw new Error('You must play — you have a playable card!');
  }

  // Draw until match rule
  if (hr.drawUntilMatch) {
    ensureDrawPile(room);
    let drawnCard;
    let drew = 0;
    do {
      if (gs.drawPile.length === 0) break;
      drawnCard = gs.drawPile.pop();
      player.hand.push(drawnCard);
      player.saidUno = false;
      drew++;
    } while (!canPlayCard(drawnCard, topCard, gs.topCardEffectiveColor, player.hand) && gs.drawPile.length > 0);
    if (drew > 0) gs.log.push(`${player.name} drew ${drew} card${drew > 1 ? 's' : ''} until match`);
    gs.drawnCardPlayerId = playerId;
    return;
  }

  // Standard draw
  ensureDrawPile(room);
  if (gs.drawPile.length === 0) {
    gs.drawnCardPlayerId = playerId;
    gs.log.push('No cards left to draw — pass your turn');
    return;
  }

  const card = gs.drawPile.pop();
  player.hand.push(card);
  player.saidUno = false;
  gs.drawnCardPlayerId = playerId;
  gs.log.push(`${player.name} drew a card`);
}

function passTurn(room, playerId) {
  const gs = room.gameState;
  if (gs.drawnCardPlayerId !== playerId) throw new Error('Must draw a card first');
  gs.drawnCardPlayerId = null;
  const player = room.players.get(playerId);
  gs.log.push(`${player.name} passed`);
  advanceTurn(room, 1);
}

function sayUno(room, playerId) {
  const player = room.players.get(playerId);
  if (player && player.hand.length === 1) {
    player.saidUno = true;
    room.gameState.log.push(`${player.name} says UNO!`);
  }
}

function catchUno(room, callerId, targetId) {
  const caller = room.players.get(callerId);
  const target = room.players.get(targetId);
  if (!caller || !target) return;
  if (target.hand.length === 1 && !target.saidUno) {
    for (let i = 0; i < 2; i++) {
      ensureDrawPile(room);
      if (room.gameState.drawPile.length > 0) target.hand.push(room.gameState.drawPile.pop());
    }
    target.saidUno = false;
    room.gameState.log.push(`${caller.name} caught ${target.name} — +2 cards!`);
  }
}

function buildGameStateForPlayer(room, playerId) {
  const player = room.players.get(playerId);
  const gs = room.gameState;
  const topCard = gs.discardPile[gs.discardPile.length - 1];

  const opponents = room.playerOrder
    .filter(id => id !== playerId)
    .map(id => {
      const p = room.players.get(id);
      return {
        id,
        name: p.name,
        cardCount: p.hand.length,
        saidUno: p.saidUno,
        isConnected: p.isConnected,
        isBot: p.isBot || false,
      };
    });

  return {
    hand: player.hand.map(c => ({ id: c.id, type: c.type, color: c.color, value: c.value })),
    topCard: { id: topCard.id, type: topCard.type, color: topCard.color, value: topCard.value },
    topCardEffectiveColor: gs.topCardEffectiveColor,
    currentPlayerId: room.playerOrder[gs.currentPlayerIndex],
    direction: gs.direction,
    drawPileCount: gs.drawPile.length,
    opponents,
    log: gs.log.slice(-8),
    pendingColorChoice: gs.pendingColorChoice,
    pendingColorPlayerId: gs.pendingColorPlayerId,
    drawnCardPlayerId: gs.drawnCardPlayerId,
    pendingDraw: gs.pendingDraw || 0,
    pendingSevenSwap: gs.pendingSevenSwap || false,
    pendingSevenSwapPlayerId: gs.pendingSevenSwapPlayerId || null,
    saidUno: player.saidUno,
    myId: playerId,
    houseRules: room.houseRules || {},
  };
}

module.exports = {
  initGame,
  playCard,
  drawCard,
  passTurn,
  chooseColor,
  autoChooseColor,
  sayUno,
  catchUno,
  buildGameStateForPlayer,
  advanceTurn,
  canPlayCard,
  executeSevenSwap,
  executeZeroRotate,
};

'use strict';

const crypto = require('node:crypto');
const { createShoe, shuffle, cardLabel } = require('./deck');
const { evaluateHand, canSplitCards } = require('./hand');

const MAX_SEATS = 5;
const START_CHIPS = 1000;
const DEFAULT_HOUSE_RULES = {
  deckCount: 6,
  dealerHitsSoft17: false, // dealer stands on all 17s
  blackjackPayout: 1.5,    // 3:2
  allowSurrender: true,
  allowDoubleAfterSplit: true,
  minBet: 5,
  maxBet: 500,
};

class Table {
  constructor(houseRules = {}) {
    this.houseRules = { ...DEFAULT_HOUSE_RULES, ...houseRules };
    this.seats = []; // up to MAX_SEATS
    this.dealer = {
      cards: [],
      eval: { total: 0, isSoft: false, isBust: false, isBlackjack: false },
      revealed: false,
    };
    this.shoe = shuffle(createShoe(this.houseRules.deckCount));
    this.totalCardsInShoe = this.shoe.length;
    this.phase = 'waiting'; // waiting | betting | insurance | player_turns | dealer_turn | round_result
    this.activeSeatIndex = -1;
    this.roundNumber = 0;
    this.roundSummary = null;
    this.log = [];
    this.insuranceTimeout = null;
  }

  addLog(msg) {
    this.log.push({ text: msg, ts: Date.now() });
    if (this.log.length > 50) this.log.shift();
  }

  addPlayer({ id, name, isBot = false, isGuest = false, isAdmin = false, chips = START_CHIPS }) {
    const existing = this.seats.find(s => s && s.id === id);
    if (existing) {
      existing.connected = true;
      existing.name = name;
      return existing;
    }
    if (this.seats.length >= MAX_SEATS) return null;

    const seat = {
      id,
      name,
      isBot: !!isBot,
      isGuest: !!isGuest,
      isAdmin: !!isAdmin,
      connected: true,
      chips: Number.isFinite(chips) ? chips : START_CHIPS,
      bet: 0,
      hands: [],
      activeHandIndex: 0,
      insurance: {
        offered: false,
        taken: false,
        bet: 0,
        result: null,
        payout: 0,
      },
      acted: false,
      lastAction: null,
    };

    this.seats.push(seat);
    this.addLog(`${name} joined the table.`);
    return seat;
  }

  removePlayer(id) {
    const idx = this.seats.findIndex(s => s && s.id === id);
    if (idx === -1) return;
    const seat = this.seats[idx];

    // If game in progress and player's turn, auto-stand their hands
    if (this.phase === 'player_turns' && this.activeSeatIndex === idx) {
      this.autoStandSeat(seat);
      this.advancePlayerTurn();
    }

    this.seats.splice(idx, 1);
    this.addLog(`${seat.name} left the table.`);

    if (this.seats.length === 0) {
      this.resetTable();
    }
  }

  setConnected(id, connected) {
    const seat = this.seats.find(s => s && s.id === id);
    if (seat) {
      seat.connected = connected;
      if (!connected && this.phase === 'player_turns' && this.seats[this.activeSeatIndex]?.id === id) {
        // Auto-stand disconnected player after timeout or immediately
        this.autoStandSeat(seat);
        this.advancePlayerTurn();
      }
    }
  }

  autoStandSeat(seat) {
    if (!seat || !seat.hands) return;
    for (const hand of seat.hands) {
      if (hand.status === 'active') {
        hand.status = 'stood';
        hand.lastAction = 'stand';
      }
    }
  }

  topUpChips(id, amount = START_CHIPS) {
    const seat = this.seats.find(s => s && s.id === id);
    if (seat && seat.chips <= 0 && this.phase !== 'player_turns') {
      seat.chips = amount;
      this.addLog(`${seat.name} topped up to $${amount}.`);
      return true;
    }
    return false;
  }

  placeBet(id, amount) {
    if (this.phase !== 'waiting' && this.phase !== 'betting' && this.phase !== 'round_result') {
      throw new Error('Bets can only be placed between rounds');
    }
    const seat = this.seats.find(s => s && s.id === id);
    if (!seat) throw new Error('Player not seated');

    const betVal = Math.floor(Number(amount));
    if (betVal < this.houseRules.minBet) {
      throw new Error(`Minimum bet is $${this.houseRules.minBet}`);
    }
    if (betVal > this.houseRules.maxBet) {
      throw new Error(`Maximum bet is $${this.houseRules.maxBet}`);
    }
    if (betVal > seat.chips) {
      throw new Error('Not enough chips');
    }

    seat.bet = betVal;
    seat.acted = true;
    return true;
  }

  clearBet(id) {
    if (this.phase !== 'waiting' && this.phase !== 'betting' && this.phase !== 'round_result') {
      throw new Error('Cannot clear bet during a hand');
    }
    const seat = this.seats.find(s => s && s.id === id);
    if (seat) {
      seat.bet = 0;
      seat.acted = false;
    }
  }

  ensureShoe() {
    // Reshuffle if penetration exceeds 75% (less than 25% cards remaining)
    if (this.shoe.length < this.totalCardsInShoe * 0.25) {
      this.shoe = shuffle(createShoe(this.houseRules.deckCount));
      this.totalCardsInShoe = this.shoe.length;
      this.addLog('Shuffling 6-deck shoe...');
    }
  }

  drawCard() {
    this.ensureShoe();
    if (this.shoe.length === 0) {
      this.shoe = shuffle(createShoe(this.houseRules.deckCount));
      this.totalCardsInShoe = this.shoe.length;
    }
    return this.shoe.pop();
  }

  startRound() {
    if (this.seats.length === 0) return false;

    // Filter seated players with valid bets
    const activeSeats = this.seats.filter(s => s && s.bet >= this.houseRules.minBet && s.chips >= s.bet);
    if (activeSeats.length === 0) {
      // If no bets placed, auto-bet for bots or prompt
      for (const s of this.seats) {
        if (s.isBot && s.chips >= this.houseRules.minBet && s.bet === 0) {
          s.bet = Math.min(s.chips, 25);
          s.acted = true;
        }
      }
    }

    const readySeats = this.seats.filter(s => s && s.bet >= this.houseRules.minBet && s.chips >= s.bet);
    if (readySeats.length === 0) return false;

    this.roundNumber++;
    this.phase = 'dealing';
    this.roundSummary = null;
    this.dealer = {
      cards: [],
      eval: { total: 0, isSoft: false, isBust: false, isBlackjack: false },
      revealed: false,
    };

    // Deduct bets and initialize player hands
    for (const seat of this.seats) {
      seat.insurance = { offered: false, taken: false, bet: 0, result: null, payout: 0 };
      seat.lastAction = null;
      seat.activeHandIndex = 0;

      if (readySeats.includes(seat)) {
        seat.chips -= seat.bet;
        seat.hands = [
          {
            id: 'h0',
            cards: [],
            bet: seat.bet,
            status: 'active',
            result: null,
            payout: 0,
            eval: { total: 0, isSoft: false, isBust: false, isBlackjack: false },
          },
        ];
      } else {
        seat.hands = [];
      }
    }

    // Deal first card to each active player, then dealer
    for (const seat of readySeats) {
      seat.hands[0].cards.push(this.drawCard());
    }
    this.dealer.cards.push(this.drawCard()); // Dealer upcard

    // Deal second card to each active player, then dealer hole card
    for (const seat of readySeats) {
      seat.hands[0].cards.push(this.drawCard());
      seat.hands[0].eval = evaluateHand(seat.hands[0].cards);
      if (seat.hands[0].eval.isBlackjack) {
        seat.hands[0].status = 'blackjack';
        this.addLog(`${seat.name} has Blackjack!`);
      }
    }
    this.dealer.cards.push(this.drawCard()); // Dealer hole card (hidden)
    this.dealer.eval = evaluateHand(this.dealer.cards);

    const dealerUpcard = this.dealer.cards[0];
    const isDealerAce = dealerUpcard.rank === 1;
    const isDealerTen = dealerUpcard.rank >= 10;

    // Check Insurance
    if (isDealerAce) {
      this.phase = 'insurance';
      let insuranceOffered = false;
      for (const seat of readySeats) {
        // Offer insurance to players who don't have natural blackjack and have chips
        if (!seat.hands[0].eval.isBlackjack && seat.chips >= Math.floor(seat.bet / 2)) {
          seat.insurance.offered = true;
          insuranceOffered = true;
        }
      }
      if (!insuranceOffered) {
        this.resolveDealerCheck();
      }
      return true;
    }

    // Check Dealer Blackjack if upcard is 10 or Ace
    if (isDealerTen) {
      this.resolveDealerCheck();
      return true;
    }

    // Normal player turns
    this.startPlayerTurns();
    return true;
  }

  handleInsurance(playerId, takeInsurance) {
    if (this.phase !== 'insurance') return;
    const seat = this.seats.find(s => s && s.id === playerId);
    if (!seat || !seat.insurance.offered) return;

    if (takeInsurance && seat.chips >= Math.floor(seat.bet / 2)) {
      const insBet = Math.floor(seat.bet / 2);
      seat.chips -= insBet;
      seat.insurance.taken = true;
      seat.insurance.bet = insBet;
      this.addLog(`${seat.name} took insurance for $${insBet}.`);
    } else {
      seat.insurance.taken = false;
      this.addLog(`${seat.name} declined insurance.`);
    }
    seat.insurance.offered = false;

    // Check if all players acted on insurance
    const pending = this.seats.some(s => s && s.insurance.offered);
    if (!pending) {
      this.resolveDealerCheck();
    }
  }

  resolveDealerCheck() {
    const dealerHasBlackjack = this.dealer.eval.isBlackjack;
    if (dealerHasBlackjack) {
      this.dealer.revealed = true;
      this.addLog(`Dealer reveals Blackjack (${cardLabel(this.dealer.cards[0])}, ${cardLabel(this.dealer.cards[1])})!`);
      this.settleRound();
    } else {
      // Clear insurance if dealer does not have BJ
      for (const seat of this.seats) {
        if (seat.insurance.taken) {
          seat.insurance.result = 'loss';
          seat.insurance.payout = 0;
        }
      }
      this.startPlayerTurns();
    }
  }

  startPlayerTurns() {
    this.phase = 'player_turns';
    this.activeSeatIndex = -1;
    this.advancePlayerTurn();
  }

  advancePlayerTurn() {
    // Find next seat/hand requiring action
    let nextSeatIdx = this.activeSeatIndex;
    if (nextSeatIdx === -1) nextSeatIdx = 0;

    while (nextSeatIdx < this.seats.length) {
      const seat = this.seats[nextSeatIdx];
      if (seat && seat.hands && seat.hands.length > 0) {
        for (let hIdx = 0; hIdx < seat.hands.length; hIdx++) {
          const hand = seat.hands[hIdx];
          if (hand.status === 'active') {
            seat.activeHandIndex = hIdx;
            this.activeSeatIndex = nextSeatIdx;
            return;
          }
        }
      }
      nextSeatIdx++;
    }

    // All player hands finished -> Dealer turn
    this.playDealerTurn();
  }

  handleAction(playerId, action) {
    if (this.phase !== 'player_turns') {
      throw new Error('Not in player turns phase');
    }
    const currentSeat = this.seats[this.activeSeatIndex];
    if (!currentSeat || currentSeat.id !== playerId) {
      throw new Error('Not your turn');
    }

    const hand = currentSeat.hands[currentSeat.activeHandIndex];
    if (!hand || hand.status !== 'active') {
      throw new Error('No active hand for player');
    }

    switch (action) {
      case 'hit': {
        const card = this.drawCard();
        hand.cards.push(card);
        hand.eval = evaluateHand(hand.cards);
        this.addLog(`${currentSeat.name} hits: ${cardLabel(card)} (Total: ${hand.eval.total})`);

        if (hand.eval.isBust) {
          hand.status = 'busted';
          this.addLog(`${currentSeat.name} busts with ${hand.eval.total}!`);
          this.advancePlayerTurn();
        } else if (hand.eval.total === 21) {
          hand.status = 'stood';
          this.advancePlayerTurn();
        }
        break;
      }
      case 'stand': {
        hand.status = 'stood';
        this.addLog(`${currentSeat.name} stands on ${hand.eval.total}.`);
        this.advancePlayerTurn();
        break;
      }
      case 'double': {
        if (hand.cards.length !== 2) {
          throw new Error('Double down is only allowed on the initial two cards');
        }
        if (currentSeat.chips < hand.bet) {
          throw new Error('Not enough chips to double down');
        }

        currentSeat.chips -= hand.bet;
        hand.bet *= 2;
        const card = this.drawCard();
        hand.cards.push(card);
        hand.eval = evaluateHand(hand.cards);
        this.addLog(`${currentSeat.name} doubles down: ${cardLabel(card)} (Total: ${hand.eval.total}, Bet: $${hand.bet})`);

        if (hand.eval.isBust) {
          hand.status = 'busted';
          this.addLog(`${currentSeat.name} busts with ${hand.eval.total}!`);
        } else {
          hand.status = 'stood';
        }
        this.advancePlayerTurn();
        break;
      }
      case 'split': {
        if (hand.cards.length !== 2 || !canSplitCards(hand.cards)) {
          throw new Error('Cards cannot be split');
        }
        if (currentSeat.hands.length >= 2) {
          throw new Error('Maximum split limit reached (2 hands)');
        }
        if (currentSeat.chips < hand.bet) {
          throw new Error('Not enough chips to split');
        }

        currentSeat.chips -= hand.bet;
        const card2 = hand.cards.pop();
        const splitHand1 = hand;
        const splitHand2 = {
          id: 'h1',
          cards: [card2],
          bet: hand.bet,
          status: 'active',
          result: null,
          payout: 0,
          eval: evaluateHand([card2]),
        };

        currentSeat.hands.push(splitHand2);

        // Deal 1 card to each hand
        splitHand1.cards.push(this.drawCard());
        splitHand1.eval = evaluateHand(splitHand1.cards);

        splitHand2.cards.push(this.drawCard());
        splitHand2.eval = evaluateHand(splitHand2.cards);

        this.addLog(`${currentSeat.name} splits hand into two.`);

        // Special rule for split Aces: get 1 card each and auto-stand
        if (card2.rank === 1) {
          splitHand1.status = 'stood';
          splitHand2.status = 'stood';
          this.advancePlayerTurn();
        }
        break;
      }
      case 'surrender': {
        if (!this.houseRules.allowSurrender || hand.cards.length !== 2 || currentSeat.hands.length > 1) {
          throw new Error('Surrender not available');
        }
        hand.status = 'surrendered';
        const refund = Math.floor(hand.bet / 2);
        currentSeat.chips += refund;
        hand.payout = refund;
        hand.result = 'surrender';
        this.addLog(`${currentSeat.name} surrenders hand (recovered $${refund}).`);
        this.advancePlayerTurn();
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  playDealerTurn() {
    this.phase = 'dealer_turn';
    this.dealer.revealed = true;
    this.dealer.eval = evaluateHand(this.dealer.cards);

    // Check if any non-busted, non-surrendered player hand exists
    const hasLiveHands = this.seats.some(s =>
      s && s.hands && s.hands.some(h => h.status === 'stood' || h.status === 'blackjack')
    );

    if (!hasLiveHands) {
      this.addLog(`Dealer reveals ${cardLabel(this.dealer.cards[0])} and ${cardLabel(this.dealer.cards[1])} (Total: ${this.dealer.eval.total}). All players busted/surrendered.`);
      this.settleRound();
      return;
    }

    this.addLog(`Dealer reveals hole card: ${cardLabel(this.dealer.cards[1])} (Total: ${this.dealer.eval.total})`);

    // Dealer draws to 17 (or soft 17 if dealerHitsSoft17)
    while (
      this.dealer.eval.total < 17 ||
      (this.houseRules.dealerHitsSoft17 && this.dealer.eval.total === 17 && this.dealer.eval.isSoft)
    ) {
      const card = this.drawCard();
      this.dealer.cards.push(card);
      this.dealer.eval = evaluateHand(this.dealer.cards);
      this.addLog(`Dealer draws ${cardLabel(card)} (Total: ${this.dealer.eval.total})`);
    }

    if (this.dealer.eval.isBust) {
      this.addLog(`Dealer busts with ${this.dealer.eval.total}!`);
    } else {
      this.addLog(`Dealer stands with ${this.dealer.eval.total}.`);
    }

    this.settleRound();
  }

  settleRound() {
    this.phase = 'round_result';
    this.activeSeatIndex = -1;
    const dEval = this.dealer.eval;
    const summary = {
      round: this.roundNumber,
      dealer: {
        cards: this.dealer.cards,
        eval: dEval,
      },
      players: [],
    };

    for (const seat of this.seats) {
      if (!seat || !seat.hands || seat.hands.length === 0) continue;
      const seatSummary = {
        id: seat.id,
        name: seat.name,
        isBot: seat.isBot,
        chipsBefore: seat.chips,
        netProfit: 0,
        hands: [],
        insurance: seat.insurance,
      };

      // Insurance settlement
      if (seat.insurance.taken) {
        if (dEval.isBlackjack) {
          const insPayout = seat.insurance.bet * 3; // 2:1 profit + return original ins bet
          seat.chips += insPayout;
          seat.insurance.result = 'win';
          seat.insurance.payout = insPayout;
          seatSummary.netProfit += seat.insurance.bet * 2;
          this.addLog(`${seat.name} wins insurance payout of $${insPayout}!`);
        } else {
          seat.insurance.result = 'loss';
          seat.insurance.payout = 0;
          seatSummary.netProfit -= seat.insurance.bet;
        }
      }

      for (const hand of seat.hands) {
        const hEval = hand.eval;
        let payout = 0;
        let result = 'loss';

        if (hand.status === 'surrendered') {
          result = 'surrender';
          payout = Math.floor(hand.bet / 2);
          seatSummary.netProfit -= (hand.bet - payout);
        } else if (hand.status === 'busted') {
          result = 'loss';
          payout = 0;
          seatSummary.netProfit -= hand.bet;
        } else if (hEval.isBlackjack) {
          if (dEval.isBlackjack) {
            result = 'push';
            payout = hand.bet; // return bet
            this.addLog(`${seat.name}'s Blackjack pushes with Dealer Blackjack.`);
          } else {
            result = 'blackjack';
            payout = hand.bet + Math.floor(hand.bet * this.houseRules.blackjackPayout); // 3:2 payout
            seatSummary.netProfit += Math.floor(hand.bet * this.houseRules.blackjackPayout);
            this.addLog(`${seat.name} wins $${payout} with natural Blackjack!`);
          }
          seat.chips += payout;
        } else if (dEval.isBlackjack) {
          // Dealer has blackjack, player does not
          result = 'loss';
          payout = 0;
          seatSummary.netProfit -= hand.bet;
        } else if (dEval.isBust) {
          // Dealer busted, player did not
          result = 'win';
          payout = hand.bet * 2; // 1:1 payout + return bet
          seat.chips += payout;
          seatSummary.netProfit += hand.bet;
          this.addLog(`${seat.name} wins $${payout} (Dealer bust).`);
        } else if (hEval.total > dEval.total) {
          result = 'win';
          payout = hand.bet * 2; // 1:1 payout + return bet
          seat.chips += payout;
          seatSummary.netProfit += hand.bet;
          this.addLog(`${seat.name} wins $${payout} (${hEval.total} vs ${dEval.total}).`);
        } else if (hEval.total === dEval.total) {
          result = 'push';
          payout = hand.bet; // return bet
          seat.chips += payout;
          this.addLog(`${seat.name} pushes (${hEval.total} vs ${dEval.total}).`);
        } else {
          result = 'loss';
          payout = 0;
          seatSummary.netProfit -= hand.bet;
          this.addLog(`${seat.name} loses (${hEval.total} vs ${dEval.total}).`);
        }

        hand.result = result;
        hand.payout = payout;
        seatSummary.hands.push({
          id: hand.id,
          cards: hand.cards,
          bet: hand.bet,
          eval: hEval,
          result,
          payout,
        });
      }

      seatSummary.chipsAfter = seat.chips;
      summary.players.push(seatSummary);
    }

    this.roundSummary = summary;
  }

  resetTable() {
    this.phase = 'waiting';
    this.activeSeatIndex = -1;
    this.roundSummary = null;
    this.dealer = {
      cards: [],
      eval: { total: 0, isSoft: false, isBust: false, isBlackjack: false },
      revealed: false,
    };
    for (const seat of this.seats) {
      if (seat) {
        seat.hands = [];
        seat.bet = 0;
        seat.acted = false;
        seat.insurance = { offered: false, taken: false, bet: 0, result: null, payout: 0 };
      }
    }
  }

  viewFor(playerId) {
    const isRoundOver = this.phase === 'round_result' || this.phase === 'waiting' || this.phase === 'betting';
    const isDealerTurn = this.phase === 'dealer_turn';

    // Mask dealer hole card if not revealed yet
    let dealerCards = [];
    let dealerEval = null;

    if (this.dealer.revealed || isRoundOver || isDealerTurn) {
      dealerCards = this.dealer.cards;
      dealerEval = this.dealer.eval;
    } else if (this.dealer.cards.length > 0) {
      // Only first card visible, second is hidden
      dealerCards = [this.dealer.cards[0], { hidden: true }];
      dealerEval = { total: evaluateHand([this.dealer.cards[0]]).total, isSoft: false, isBust: false, isBlackjack: false };
    }

    const currentSeat = this.seats[this.activeSeatIndex];
    const isMyTurn = currentSeat && currentSeat.id === playerId && this.phase === 'player_turns';
    const mySeat = this.seats.find(s => s && s.id === playerId);
    const myHand = mySeat?.hands?.[mySeat.activeHandIndex];

    const canHit = isMyTurn && myHand && myHand.status === 'active' && myHand.eval.total < 21;
    const canStand = isMyTurn && myHand && myHand.status === 'active';
    const canDouble = isMyTurn && myHand && myHand.cards.length === 2 && mySeat.chips >= myHand.bet;
    const canSplit = isMyTurn && myHand && myHand.cards.length === 2 && canSplitCards(myHand.cards) && mySeat.hands.length < 2 && mySeat.chips >= myHand.bet;
    const canSurrender = isMyTurn && myHand && myHand.cards.length === 2 && mySeat.hands.length === 1 && this.houseRules.allowSurrender;
    const canInsurance = this.phase === 'insurance' && mySeat?.insurance?.offered;

    return {
      phase: this.phase,
      roundNumber: this.roundNumber,
      activeSeatId: currentSeat ? currentSeat.id : null,
      activeSeatIndex: this.activeSeatIndex,
      activeHandIndex: currentSeat ? currentSeat.activeHandIndex : 0,
      dealer: {
        cards: dealerCards,
        eval: dealerEval,
        revealed: this.dealer.revealed,
      },
      seats: this.seats.map(s => ({
        id: s.id,
        name: s.name,
        isBot: s.isBot,
        isGuest: s.isGuest,
        isAdmin: s.isAdmin,
        connected: s.connected,
        chips: s.chips,
        bet: s.bet,
        acted: s.acted,
        insurance: s.insurance,
        hands: s.hands.map(h => ({
          id: h.id,
          cards: h.cards,
          bet: h.bet,
          status: h.status,
          eval: h.eval,
          result: h.result,
          payout: h.payout,
        })),
      })),
      houseRules: this.houseRules,
      roundSummary: this.roundSummary,
      availableActions: {
        canHit: !!canHit,
        canStand: !!canStand,
        canDouble: !!canDouble,
        canSplit: !!canSplit,
        canSurrender: !!canSurrender,
        canInsurance: !!canInsurance,
      },
      log: this.log.slice(-15),
      shoeCardsRemaining: this.shoe.length,
    };
  }
}

module.exports = {
  Table,
  MAX_SEATS,
  START_CHIPS,
  DEFAULT_HOUSE_RULES,
};

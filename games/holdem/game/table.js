// Texas Hold'em table: seats, blinds, betting rounds, showdown with layered side
// pots. No-limit rules for 2–6 players. Intentionally "simple": cash-style stacks
// that top back up between hands, no timers (a disconnected player auto-checks/folds
// when it's their turn), and heads-up uses standard button-posts-small-blind.

const { freshDeck, shuffle } = require('./deck');
const { evaluate7, compare } = require('./handEval');

const START_STACK = 1000;
const SMALL_BLIND = 5;
const BIG_BLIND = 10;
const MAX_SEATS = 6;

class Table {
  constructor() {
    this.seats = [];            // players in seat order
    this.board = [];
    this.deck = [];
    this.phase = 'waiting';     // waiting|preflop|flop|turn|river|showdown
    this.button = 0;
    this.toAct = -1;            // index of player to act
    this.currentBet = 0;        // highest per-round contribution to match
    this.minRaise = BIG_BLIND;
    this.lastResult = null;     // showdown summary for display
    this.handId = 0;
  }

  activeSeats() { return this.seats.filter(p => !p.sittingOut && p.chips > 0); }

  addPlayer({ id, name, isGuest }) {
    if (this.seats.find(p => p.id === id)) return true;
    if (this.seats.length >= MAX_SEATS) return false;
    this.seats.push({
      id, name, isGuest: !!isGuest, chips: START_STACK,
      hole: [], bet: 0, committed: 0, folded: false, allIn: false,
      acted: false, sittingOut: false, connected: true, lastAction: null,
    });
    return true;
  }

  removePlayer(id) {
    const p = this.seats.find(s => s.id === id);
    if (!p) return;
    // If a hand is live, fold them; otherwise drop the seat.
    if (this.phase !== 'waiting' && this.phase !== 'showdown' && !p.folded) {
      p.folded = true;
      p.connected = false;
      if (this.seats[this.toAct] && this.seats[this.toAct].id === id) this.advanceAction();
      this.maybeEndRound();
    } else {
      this.seats = this.seats.filter(s => s.id !== id);
    }
  }

  setConnected(id, val) {
    const p = this.seats.find(s => s.id === id);
    if (p) p.connected = val;
  }

  canStart() { return this.activeSeats().length >= 2 && (this.phase === 'waiting' || this.phase === 'showdown'); }

  startHand() {
    const live = this.activeSeats();
    if (live.length < 2) { this.phase = 'waiting'; return; }
    this.handId++;
    this.deck = shuffle(freshDeck());
    this.board = [];
    this.lastResult = null;
    this.phase = 'preflop';
    this.currentBet = 0;
    this.minRaise = BIG_BLIND;

    for (const p of this.seats) {
      p.hole = []; p.bet = 0; p.committed = 0; p.folded = p.sittingOut || p.chips <= 0;
      p.allIn = false; p.acted = false; p.lastAction = null;
    }

    // Rotate button to next live seat.
    this.button = this.nextOccupied(this.button, true);
    const order = this.orderFrom(this.button);
    const contenders = order.filter(i => !this.seats[i].folded);

    // Blinds. Heads-up: button is small blind.
    let sbIdx, bbIdx;
    if (contenders.length === 2) {
      sbIdx = this.button;
      bbIdx = contenders.find(i => i !== this.button);
    } else {
      sbIdx = contenders[1];
      bbIdx = contenders[2];
    }
    this.postBlind(sbIdx, SMALL_BLIND);
    this.postBlind(bbIdx, BIG_BLIND);
    this.currentBet = BIG_BLIND;

    // Deal two hole cards to each contender.
    for (let round = 0; round < 2; round++)
      for (const i of contenders) this.seats[i].hole.push(this.deck.pop());

    // First to act preflop is left of big blind.
    this.toAct = this.nextToAct(bbIdx);
    // Everyone still needs to act (blinds haven't voluntarily acted).
    for (const i of contenders) this.seats[i].acted = false;
  }

  postBlind(idx, amount) {
    const p = this.seats[idx];
    const post = Math.min(amount, p.chips);
    p.chips -= post; p.bet += post; p.committed += post;
    if (p.chips === 0) p.allIn = true;
  }

  orderFrom(start) {
    const idx = [];
    for (let k = 0; k < this.seats.length; k++) idx.push((start + k) % this.seats.length);
    return idx;
  }

  nextOccupied(from, skipCurrent) {
    const n = this.seats.length;
    for (let k = skipCurrent ? 1 : 0; k <= n; k++) {
      const i = (from + k) % n;
      if (this.seats[i] && !this.seats[i].sittingOut && this.seats[i].chips > 0) return i;
    }
    return from;
  }

  // Next player who can act (not folded, not all-in) after index `from`.
  nextToAct(from) {
    const n = this.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      const p = this.seats[i];
      if (p && !p.folded && !p.allIn) return i;
    }
    return -1;
  }

  advanceAction() { this.toAct = this.nextToAct(this.toAct); }

  // A player action: { type: 'fold'|'check'|'call'|'bet'|'raise'|'allin', amount }
  // `amount` for bet/raise is the TOTAL this-round contribution to raise TO.
  act(playerId, action) {
    if (this.toAct < 0) return { error: 'No action expected' };
    const p = this.seats[this.toAct];
    if (!p || p.id !== playerId) return { error: 'Not your turn' };
    const type = action.type;
    const toCall = this.currentBet - p.bet;

    if (type === 'fold') {
      p.folded = true; p.lastAction = 'fold';
    } else if (type === 'check') {
      if (toCall > 0) return { error: 'Cannot check facing a bet' };
      p.lastAction = 'check';
    } else if (type === 'call') {
      const pay = Math.min(toCall, p.chips);
      this.putIn(p, pay);
      p.lastAction = pay < toCall ? 'all-in' : 'call';
    } else if (type === 'bet' || type === 'raise' || type === 'allin') {
      let target;
      if (type === 'allin') target = p.bet + p.chips;
      else target = Math.floor(action.amount || 0);
      const raiseBy = target - this.currentBet;
      const isAllIn = target >= p.bet + p.chips;
      if (!isAllIn) {
        if (target <= this.currentBet) return { error: 'Raise must exceed current bet' };
        if (raiseBy < this.minRaise) return { error: `Min raise is ${this.minRaise}` };
      }
      const pay = Math.min(target - p.bet, p.chips);
      this.putIn(p, pay);
      if (p.bet > this.currentBet) {
        if (p.bet - this.currentBet >= this.minRaise) this.minRaise = p.bet - this.currentBet;
        this.currentBet = p.bet;
        // A legit raise reopens action for everyone else.
        for (const q of this.seats) if (!q.folded && !q.allIn && q !== p) q.acted = false;
      }
      p.lastAction = isAllIn ? 'all-in' : (type === 'bet' ? 'bet' : 'raise');
    } else {
      return { error: 'Unknown action' };
    }

    p.acted = true;
    this.advanceAction();
    this.maybeEndRound();
    return { ok: true };
  }

  putIn(p, amount) {
    const pay = Math.min(amount, p.chips);
    p.chips -= pay; p.bet += pay; p.committed += pay;
    if (p.chips === 0) p.allIn = true;
  }

  // If only one player remains, or the betting round is complete, advance.
  maybeEndRound() {
    const contenders = this.seats.filter(p => !p.folded);
    if (contenders.length === 1) return this.awardUncontested(contenders[0]);

    const canAct = contenders.filter(p => !p.allIn);
    const roundDone = canAct.every(p => p.acted && p.bet === this.currentBet);
    if (this.toAct === -1 || roundDone) this.nextStreet();
  }

  nextStreet() {
    // Move this round's bets into committed pot bookkeeping (already tracked via
    // p.committed), reset per-round bet state.
    for (const p of this.seats) { p.bet = 0; p.acted = false; }
    this.currentBet = 0;
    this.minRaise = BIG_BLIND;

    if (this.phase === 'preflop') { this.deal(3); this.phase = 'flop'; }
    else if (this.phase === 'flop') { this.deal(1); this.phase = 'turn'; }
    else if (this.phase === 'turn') { this.deal(1); this.phase = 'river'; }
    else if (this.phase === 'river') { return this.showdown(); }

    // If everyone remaining is all-in, run out the board to showdown.
    const contenders = this.seats.filter(p => !p.folded);
    if (contenders.filter(p => !p.allIn).length <= 1) {
      while (this.phase !== 'river') {
        if (this.phase === 'flop') { this.deal(1); this.phase = 'turn'; }
        else if (this.phase === 'turn') { this.deal(1); this.phase = 'river'; }
      }
      return this.showdown();
    }
    // First to act after the button on later streets.
    this.toAct = this.nextToAct(this.button);
  }

  deal(n) {
    for (let i = 0; i < n; i++) this.board.push(this.deck.pop());
  }

  awardUncontested(winner) {
    const pot = this.seats.reduce((s, p) => s + p.committed, 0);
    winner.chips += pot;
    this.lastResult = {
      board: this.board.slice(),
      winners: [{ id: winner.id, name: winner.name, amount: pot, hand: null, uncontested: true }],
      showdown: [],
    };
    for (const p of this.seats) p.committed = 0;
    this.phase = 'showdown';
    this.toAct = -1;
  }

  // Layered side pots: settle each all-in level fairly.
  showdown() {
    const contenders = this.seats.filter(p => !p.folded);
    const evals = new Map();
    for (const p of contenders) {
      evals.set(p.id, evaluate7([...p.hole, ...this.board]));
    }

    // Build pots from cumulative commitments across all seats (folded chips count).
    const players = this.seats.filter(p => p.committed > 0);
    const levels = [...new Set(players.map(p => p.committed))].sort((a, b) => a - b);
    let prev = 0;
    const winnersAgg = new Map(); // id -> amount won
    for (const level of levels) {
      const layer = level - prev;
      const contributors = players.filter(p => p.committed >= level);
      const potSize = layer * contributors.length;
      prev = level;
      // Eligible = non-folded contributors at this level.
      const eligible = contributors.filter(p => !p.folded);
      if (!eligible.length) continue;
      let best = null; let winners = [];
      for (const p of eligible) {
        const e = evals.get(p.id);
        const c = best ? compare(e, best) : 1;
        if (c > 0) { best = e; winners = [p]; }
        else if (c === 0) winners.push(p);
      }
      const share = Math.floor(potSize / winners.length);
      let remainder = potSize - share * winners.length;
      for (const w of winners) {
        let amt = share;
        if (remainder > 0) { amt++; remainder--; } // odd chip to first winner(s)
        w.chips += amt;
        winnersAgg.set(w.id, (winnersAgg.get(w.id) || 0) + amt);
      }
    }

    this.lastResult = {
      board: this.board.slice(),
      winners: [...winnersAgg.entries()].map(([id, amount]) => {
        const p = this.seats.find(s => s.id === id);
        return { id, name: p.name, amount, hand: evals.get(id).name };
      }),
      showdown: contenders.map(p => ({
        id: p.id, name: p.name, hole: p.hole, hand: evals.get(p.id).name,
      })),
    };
    for (const p of this.seats) p.committed = 0;
    this.phase = 'showdown';
    this.toAct = -1;
  }

  potTotal() { return this.seats.reduce((s, p) => s + p.committed + p.bet, 0); }

  // View for a specific player (hides other players' hole cards until showdown).
  viewFor(playerId) {
    return {
      phase: this.phase,
      board: this.board.map(c => c),
      pot: this.potTotal(),
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      button: this.button,
      toAct: this.toAct >= 0 ? this.seats[this.toAct]?.id : null,
      bigBlind: BIG_BLIND,
      handId: this.handId,
      lastResult: this.lastResult,
      seats: this.seats.map((p, i) => ({
        seat: i, id: p.id, name: p.name, isGuest: p.isGuest,
        chips: p.chips, bet: p.bet, folded: p.folded, allIn: p.allIn,
        connected: p.connected, sittingOut: p.sittingOut, lastAction: p.lastAction,
        isButton: i === this.button, isTurn: i === this.toAct,
        hole: (p.id === playerId || this.phase === 'showdown') && !p.folded ? p.hole : null,
        hasCards: p.hole.length > 0 && !p.folded,
      })),
    };
  }
}

module.exports = { Table, START_STACK, SMALL_BLIND, BIG_BLIND, MAX_SEATS };

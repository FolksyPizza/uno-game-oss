'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Table } = require('../game/table');

test('table manages seats and chips', () => {
  const table = new Table();
  const player = table.addPlayer({ id: 'p1', name: 'Alice', chips: 1000 });
  assert.ok(player);
  assert.equal(table.seats.length, 1);
  assert.equal(table.seats[0].chips, 1000);

  table.placeBet('p1', 50);
  assert.equal(table.seats[0].bet, 50);

  table.clearBet('p1');
  assert.equal(table.seats[0].bet, 0);
});

test('deals cards and progresses round', () => {
  const table = new Table();
  table.addPlayer({ id: 'p1', name: 'Alice', chips: 1000 });
  table.placeBet('p1', 25);

  const started = table.startRound();
  assert.equal(started, true);
  assert.equal(table.seats[0].chips, 975); // 1000 - 25
  assert.equal(table.seats[0].hands.length, 1);
  assert.equal(table.seats[0].hands[0].cards.length, 2);
  assert.equal(table.dealer.cards.length, 2);
});

test('handles player stand and dealer resolution', () => {
  const table = new Table();
  table.addPlayer({ id: 'p1', name: 'Alice', chips: 1000 });
  table.placeBet('p1', 20);
  table.startRound();

  if (table.phase === 'insurance') {
    table.handleInsurance('p1', false);
  }

  if (table.phase === 'player_turns') {
    assert.equal(table.activeSeatIndex, 0);
    table.handleAction('p1', 'stand');
  }

  // After player stands, dealer plays out and round settles
  assert.equal(table.phase, 'round_result');
  assert.ok(table.dealer.revealed);
  assert.ok(table.dealer.eval.total >= 17 || table.dealer.eval.isBust);
  assert.ok(table.roundSummary);
});

test('handles player double down', () => {
  const table = new Table();
  table.addPlayer({ id: 'p1', name: 'Bob', chips: 1000 });
  table.placeBet('p1', 50);
  table.startRound();

  if (table.phase === 'insurance') {
    table.handleInsurance('p1', false);
  }

  if (table.phase === 'player_turns') {
    table.handleAction('p1', 'double');
    assert.equal(table.seats[0].hands[0].cards.length, 3);
    assert.equal(table.seats[0].hands[0].bet, 100);
    assert.equal(table.phase, 'round_result');
  }
});

test('viewFor masks dealer hole card when round is active', () => {
  const table = new Table();
  table.addPlayer({ id: 'p1', name: 'Alice', chips: 1000 });
  table.placeBet('p1', 25);
  table.startRound();

  if (table.phase === 'player_turns') {
    const view = table.viewFor('p1');
    assert.equal(view.dealer.cards.length, 2);
    assert.equal(view.dealer.cards[1].hidden, true);
    assert.equal(view.dealer.revealed, false);
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { filterMessage, containsBadWord, normalizeWord } = require('../../../core/profanity');

// ── normalizeWord ────────────────────────────────────────────────────────────

test('normalizeWord: lowercases and strips diacritics', () => {
  assert.equal(normalizeWord('FÜCK'), 'fuck');
  assert.equal(normalizeWord('Çà'), 'ca');
});

test('normalizeWord: applies leet substitutions', () => {
  assert.equal(normalizeWord('sh1t'), 'shit');
  assert.equal(normalizeWord('@$$'), 'ass');
  assert.equal(normalizeWord('f0rk'), 'fork');
});

test('normalizeWord: drops non-letter punctuation', () => {
  assert.equal(normalizeWord('f.u.c.k'), 'fuck');
  assert.equal(normalizeWord('s-h-i-t'), 'shit');
});

// ── filterMessage — should mask ──────────────────────────────────────────────

test('filterMessage: masks plain bad word', () => {
  assert.equal(filterMessage('you fuck'), 'you ****');
});

test('filterMessage: masks leet variant', () => {
  assert.equal(filterMessage('sh1t'), '****');
});

test('filterMessage: masks dot-separated', () => {
  assert.equal(filterMessage('f.u.c.k off'), '******* off');
});

test('filterMessage: masks diacritic variant', () => {
  assert.equal(filterMessage('fück'), '****');
});

test('filterMessage: masks spaced-out attack', () => {
  // Each letter is a separate token; sliding window catches the concatenation.
  const result = filterMessage('S H 1 T');
  assert.equal(result, '* * * *');
});

test('filterMessage: case-insensitive match', () => {
  assert.equal(filterMessage('AsShOlE'), '*******');
});

test('filterMessage: trims and caps at 200 chars', () => {
  const long = 'a'.repeat(300);
  assert.equal(filterMessage(long).length, 200);
  assert.equal(filterMessage('   hello   '), 'hello');
});

// ── filterMessage — should NOT mask (false positives) ────────────────────────

test('filterMessage: does not match substrings inside benign words', () => {
  assert.equal(filterMessage('classic'), 'classic');
  assert.equal(filterMessage('pass'), 'pass');
  assert.equal(filterMessage('assassinate'), 'assassinate');
  assert.equal(filterMessage('Cassie'), 'Cassie');
  assert.equal(filterMessage('Scunthorpe'), 'Scunthorpe');
});

test('filterMessage: does not match short words', () => {
  // Single letters/short words below min bad-word length never trigger.
  assert.equal(filterMessage('a b c'), 'a b c');
});

test('filterMessage: leaves non-string input as empty string', () => {
  assert.equal(filterMessage(null), '');
  assert.equal(filterMessage(undefined), '');
  assert.equal(filterMessage(42), '');
});

// ── containsBadWord ──────────────────────────────────────────────────────────

test('containsBadWord: detects bad usernames', () => {
  assert.equal(containsBadWord('asshole'), true);
  assert.equal(containsBadWord('Sh1t'), true);
  assert.equal(containsBadWord('F.U.C.K'), true);
});

test('containsBadWord: allows benign names containing substrings', () => {
  assert.equal(containsBadWord('Classic'), false);
  assert.equal(containsBadWord('Cassie'), false);
  assert.equal(containsBadWord('Passport'), false);
  assert.equal(containsBadWord('Alice'), false);
});

test('containsBadWord: detects spaced-letter usernames', () => {
  assert.equal(containsBadWord('s h i t'), true);
});

# Multiplayer UNO — Agent Reference

This document is the authoritative technical reference for AI agents working in this codebase. It describes the current implementation, data structures, WebSocket protocol, and critical invariants. Read this before making any changes.

## Tech Stack

- **Backend**: Node.js + Express + `ws` WebSockets
- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **State**: In-memory only (`Map` of rooms — no database)
- **Packages**: `express`, `ws`, `uuid`
- **Deployment**: Docker + Nginx Proxy Manager

## Project Structure

```
├── server.js           # HTTP + WebSocket server, message router, bot execution
├── game/
│   ├── deck.js         # 108-card deck creation and Fisher-Yates shuffle
│   ├── gameState.js    # All UNO game logic (pure-ish functions operating on room)
│   ├── room.js         # Room/player lifecycle, bot management
│   ├── bot.js          # Bot AI — card scoring, color choice, swap targeting
│   └── profanity.js    # Chat filter and username validator
├── public/
│   ├── index.html      # Lobby, waiting room, game screen (3 screens, single page)
│   ├── style.css       # Card visuals, layout, modals
│   └── client.js       # WebSocket client, rendering, event handling
├── Dockerfile
├── docker-compose.yml
└── nginx/
    └── setup-npm.sh    # One-shot TLS cert + NPM proxy configuration
```

---

## Key Data Structures

### Card
```js
{
  id: string,         // uuid
  type: 'number' | 'skip' | 'reverse' | 'draw_two' | 'wild' | 'wild_draw_four',
  color: 'red' | 'blue' | 'green' | 'yellow' | 'wild',
  value: number | null   // 0-9 for number cards, null otherwise
}
```

### Room
```js
{
  code: string,          // 4-letter uppercase room code
  hostId: string,        // playerId of current host
  players: Map<id, Player>,
  playerOrder: string[], // ordered list of player IDs (includes bots)
  phase: 'waiting' | 'playing' | 'over',
  gameState: GameState | null,
  houseRules: HouseRules,
  chat: ChatEntry[],     // max 100 entries
  isPublic: boolean,     // whether room appears in public browser
}
```

### Player
```js
{
  id: string,
  name: string,
  ws: WebSocket | null,  // null for bots and disconnected players
  hand: Card[],
  isConnected: boolean,  // false if disconnected (bots always true)
  isHost: boolean,
  isBot: boolean,
  saidUno: boolean,
}
```

### GameState
```js
{
  drawPile: Card[],
  discardPile: Card[],
  currentPlayerIndex: number,     // index into room.playerOrder
  direction: 1 | -1,
  pendingColorChoice: boolean,
  pendingColorPlayerId: string | null,
  topCardEffectiveColor: string,
  drawnCardPlayerId: string | null, // set when player has drawn but not yet played/passed
  pendingDraw: number,              // accumulated +2 stack (house rule)
  pendingSevenSwap: boolean,        // waiting for player to pick swap target
  pendingSevenSwapPlayerId: string | null,
  log: string[],                    // last ~12 human-readable game events
  winnerId: string | null,
  houseRules: HouseRules,           // snapshot from room at game start
}
```

### HouseRules
```js
{
  stackDrawCards: boolean,   // +2 on +2; accumulates into pendingDraw
  drawUntilMatch: boolean,   // keep drawing until you get a playable card
  forcePlay: boolean,        // cannot draw if you have a playable card
  sevenO: boolean,           // 7 = swap hands, 0 = rotate all hands
}
```

---

## WebSocket Protocol

### Client → Server

| type | key payload fields | notes |
|------|--------------------|-------|
| `create_room` | `playerName`, `isPublic?` | creates room; host is creator |
| `join_room` | `playerName`, `roomCode`, `playerId?` | `playerId` triggers reconnect-by-ID |
| `start_game` | — | host only; requires ≥2 players |
| `play_card` | `cardIndex` | index into sender's hand |
| `draw_card` | — | draws one card; sets drawnCardPlayerId |
| `pass_turn` | — | only valid after drawing |
| `choose_color` | `color` | `'red'|'blue'|'green'|'yellow'` |
| `say_uno` | — | marks saidUno=true if hand.length===1 |
| `catch_uno` | `targetPlayerId` | target draws 2 if hand.length===1 && !saidUno |
| `seven_swap_target` | `targetPlayerId` | resolves pendingSevenSwap |
| `chat_message` | `text` | filtered before broadcast |
| `configure_rules` | `rules: HouseRules` | host only, waiting phase only |
| `add_bot` | — | host only, waiting phase only |
| `remove_bot` | `botId` | host only, waiting phase only |
| `kick_player` | `targetId` | host only, waiting phase only; sends `kicked` to target |
| `end_game` | — | host only, playing phase; resets to waiting immediately |
| `set_visibility` | `isPublic` | host only, waiting phase; toggles public listing |
| `list_rooms` | — | no room required; returns public waiting rooms |

### Server → Client

| type | key payload fields |
|------|-------------------|
| `room_created` | `roomCode, playerId, players, hostId, houseRules, isPublic, chatHistory` |
| `room_joined` | `roomCode, playerId, players, hostId, houseRules, isPublic, chatHistory` |
| `room_updated` | `players, hostId, houseRules, isPublic` |
| `game_started` | — (signals transition; game_state_update follows immediately) |
| `game_state_update` | `hand, topCard, topCardEffectiveColor, currentPlayerId, direction, drawPileCount, opponents, log, pendingColorChoice, pendingColorPlayerId, drawnCardPlayerId, pendingDraw, pendingSevenSwap, pendingSevenSwapPlayerId, houseRules, saidUno` |
| `choose_color_prompt` | — |
| `game_over` | `winnerId, winnerName` |
| `chat_broadcast` | `name, text, ts` |
| `rooms_list` | `rooms: [{code, hostName, playerCount, botCount}]` |
| `kicked` | `message` |
| `error` | `message` |

**Opponents array** (inside `game_state_update`):
```js
[{ id, name, cardCount, saidUno, isConnected, isBot }]
```

---

## File-by-File Reference

### `game/deck.js`
- `createDeck()` → 108 cards: 1×0 + 2×(1–9) + 2×Skip/Reverse/DrawTwo per color + 4 Wild + 4 WildDraw4
- `shuffleDeck(cards)` → Fisher-Yates in place
- `dealHands(deck, playerCount)` → round-robin 7 each, returns `{ hands, remaining }`

### `game/gameState.js`
- `initGame(room)` — shuffle, deal 7 each, flip top (re-flip if WD4), apply initial card effect
- `canPlayCard(card, topCard, effectiveColor, hand, pendingDrawType?)` — 5th param: if `'draw_two'` only draw_two cards are valid (stack rule)
- `playCard(room, playerId, cardIndex)` — validate turn + legality, remove from hand, push discard, `applyCardEffect`, check win; handles sevenO on 7 and 0
- `applyCardEffect(room, card)` — Skip: +2 steps; Reverse: flip direction (+2 if 2-player); DrawTwo: advance 1, target draws 2, advance 1 again (or accumulate if stackDrawCards); Wild/WD4: set pendingColorChoice; number: +1
- `chooseColor(room, playerId, color)` — resolves pendingColorChoice; if WD4 advances to target, they draw 4, advance again; else +1
- `drawCard(room, playerId)` — draws one card (or all pending if pendingDraw>0 and stackDrawCards); enforces forcePlay; handles drawUntilMatch; sets drawnCardPlayerId
- `passTurn(room, playerId)` — clears drawnCardPlayerId, advances turn
- `sayUno(room, playerId)` — sets saidUno=true if hand.length===1
- `catchUno(room, callerId, targetId)` — target draws 2 if hand.length===1 && !saidUno
- `executeSevenSwap(room, playerId, targetId)` — swaps hands, clears pendingSevenSwap, advances turn
- `executeZeroRotate(room)` — rotates all hands in play direction
- `advanceTurn(room, steps)` — wraps playerOrder, skips disconnected players (caps at playerOrder.length to avoid infinite loop)
- `buildGameStateForPlayer(room, playerId)` — returns filtered state: full hand for self, only counts for opponents
- `ensureDrawPile(room)` — reshuffles discard (keeps top) when draw pile empties
- `autoChooseColor(room)` — picks most-common color in current player's hand (used on disconnect)

### `game/room.js`
- `BOT_NAMES` — array of 32 themed names (Blaze, Nova, Pixel, …)
- `DEFAULT_HOUSE_RULES` — all false by default
- `generateRoomCode(rooms)` — random 4-letter uppercase, collision-checked
- `createRoom(rooms, playerName, ws, isPublic?)` — creates room with isPublic flag (default false)
- `joinRoom(rooms, code, playerName, ws, reconnectId?)` — reconnect-by-ID first, then reconnect-by-name (excludes bots), then new join; enforces unique names and 8-player limit; only allows new joins in waiting phase
- `addBot(room)` — picks random unused name from BOT_NAMES; falls back to "Bot N"
- `removeBot(room, botId)` — removes bot from players map and playerOrder

### `game/bot.js`
- `getBotAction(room, botId)` → `{action:'play', cardIndex}` or `{action:'draw'}` — scores cards: WD4=1 (saves for emergency), Wild=2, matching action=8–9, matching number=6, off-color action=4, off-color number=3
- `getBotColorChoice(room, botId)` → most common color in hand
- `getBotSwapTarget(room, botId)` → connected player with fewest cards

### `game/profanity.js`
- `BAD_WORDS` — ~60 terms covering sexual content, slurs, and strong profanity
- `filterMessage(text)` — replaces matched words with asterisks using `\b` word boundaries; trims to 200 chars
- `containsBadWord(text)` → boolean — used to reject usernames

### `server.js`
- Express serves `public/` statically
- `WebSocketServer` shares the same HTTP server
- Each `ws` gets `.playerId` and `.roomCode` set on join/create
- `broadcast(room, payload, excludeId?)` — sends to all connected non-bot players
- `broadcastGameState(room)` — sends per-player `game_state_update` to each connected non-bot
- `roomInfo(room)` → `{players, hostId, houseRules, isPublic}` — used in all room-related broadcasts
- `roomPlayers(room)` → array of `{id, name, isBot}` for connected players
- `handleGameOver(room)` — broadcasts `game_over`, reassigns host if needed, then after 5s resets room to waiting and broadcasts `room_updated`
- `handleDisconnect(ws)` — waiting: removes player, reassigns host if needed, deletes room if no humans left; playing: marks disconnected, auto-resolves pending actions (color choice, seven swap, or turn advance), deletes room only if ALL humans disconnected
- `checkAndTriggerBot(room)` — after any game state change, schedules bot turn if current player is a bot; handles pendingColorChoice and pendingSevenSwap bot decisions
- `executeBotTurn(room, botId)` — calls getBotAction, executes draw+play-or-pass or play, says UNO if 1 card left, calls handleGameOver if winnerId set
- Stale room cleanup: `setInterval` every 15 min, removes rooms with no connected humans

### `public/client.js`
**State**: `ws`, `myPlayerId`, `myRoomCode`, `myPlayerName`, `isHost`, `currentState`, `currentScreen`, `reconnecting`, `currentHouseRules`, `chatMessages`, `chatUnread`, `activeChatTab`, `pendingKickId`

**Key functions**:
- `connect()` — creates WebSocket, saves session to sessionStorage on close, auto-retries after 2.5s
- `tryReconnect()` — on reconnect, sends `join_room` with saved name/code/playerId from sessionStorage
- `handleServerMessage(msg)` — routes all server messages to render/state functions
- `renderWaiting(players, hostId, code, houseRules, isPublic)` — renders player list (with kick/remove-bot buttons for host), house rules toggles (host) or badges (non-host), visibility toggle (host), status text, add-bot button
- `renderGameState(state)` — updates turn banner, direction, pending draw badge, opponents panel, discard/draw piles, hand, activity log, seven-swap modal; shows/hides end-game button for host
- `renderOpponents(state)` — opponent cards with disconnected/UNO/bot badges and Catch UNO buttons
- `renderHand(state, isMyTurn, hasDrawn, pendingDraw)` — highlights playable cards, wires click handlers
- `renderSevenSwapModal(opponents)` — shows swap target buttons for all connected opponents
- `renderRoomsList(rooms)` — renders public room entries with Join buttons in lobby
- `renderGameRuleBadges(rules)` — compact badges in game header
- `isCardPlayable(card, state, pendingDrawType?)` — mirrors server canPlayCard for client-side highlight only
- `buildCard(card, overrideColor, {clickable})` → card DOM element
- `showGameOver(winnerName, isMe)` — shows overlay with progress bar, auto-hides after 5.2s
- `appendChatMessage(name, text, ts, silent?)` — appends to both waiting and game chat logs
- `switchTab(tab)` — switches between Activity and Chat tabs in game screen
- `showModal(id)` / `hideModal(id)` — toggles modal visibility

---

## Critical Invariants

1. **WD4 initial flip** — `initGame` loops re-flip until top card is not wild_draw_four
2. **Wild initial card** — sets pendingColorChoice=true; first player must choose color before any play
3. **2-player Reverse = Skip** — `applyCardEffect` advances 2 steps when playerOrder.length===2
4. **Stack Draw Cards** — `pendingDraw` accumulates; `canPlayCard` only allows draw_two cards when `pendingDrawType='draw_two'`; drawing takes all pending, advances turn
5. **WD4 legality** — server checks hand has no cards matching effectiveColor; strictly enforced, no challenge mechanic
6. **UNO saidUno reset** — reset to false whenever `hand.length !== 1`
7. **Catch window** — valid any time `target.hand.length===1 && !target.saidUno`
8. **Disconnected player turn** — server auto-advances; auto-resolves pendingColorChoice (autoChooseColor) and pendingSevenSwap (picks first available target); game does NOT end because one human disconnected
9. **Room deletion** — only when all human players are disconnected (bots alone ≠ valid room)
10. **Host reassignment** — on host disconnect or kick, first non-bot player in playerOrder becomes host; bots cannot be host
11. **Bot broadcasts** — `broadcast()` and `broadcastGameState()` skip bots (they have no WebSocket)
12. **Public room listing** — `list_rooms` only returns rooms where `isPublic===true && phase==='waiting'`
13. **Reconnect flow** — `join_room` with matching `playerId` (sessionStorage) reconnects by ID first; then by matching name among disconnected non-bot players; both paths restore existing hand

---

## Known Issues (pending fix)

- **`list_rooms`, `end_game`, `set_visibility`, `kick_player` return "Unknown message type"** — All four handlers were added in the latest commit. If you see this error, the running server process has not been restarted and is still executing old code. Restart with `node server.js` (or `docker compose up -d --build` for Docker).
- **Bot random names not applying** — Same root cause: `game/room.js` was updated but the old process is still running. Restart the server.
- **Duplicate names in a room** — Currently enforced only for connected players joining during waiting phase. Bot names are drawn from a pool but do not guarantee uniqueness across reconnects. A future fix should check all players (connected + disconnected) and bot names together on every join.

---

## Development Notes

Always restart the server after editing any `game/` or `server.js` file — Node.js does not hot-reload. For Docker, run `docker compose up -d --build`.

---

## Server Log Prefixes

```
[ROOM]  Room created or deleted
[JOIN]  Player joined or rejoined
[GAME]  Game started
[PLAY]  Card played
[DRAW]  Card drawn
[UNO]   UNO called
[CATCH] UNO caught
[SWAP]  Seven-swap executed
[COLOR] Color chosen
[BOT]   Bot action or added/removed
[DISC]  Player disconnected
[WIN]   Game won
[END]   Host ended game early
[KICK]  Player kicked
[HOST]  Host reassigned
[RULE]  House rules changed
[VIS]   Room visibility changed
[CLEAN] Stale room cleaned up
```

# UNO — Multiplayer Card Game

Real-time multiplayer UNO card game built with Node.js and WebSockets. Up to 8 players (humans + bots) per room.

## Features

- Create or join rooms with random 4-letter codes; optional **share link** with `?room=ABCD`
- **Public rooms** — mark a room as public and it appears in the in-lobby room browser; private by default
- Full UNO rules: Skip, Reverse, Draw Two, Wild, Wild Draw Four
- **CPU bots** with adaptive card-scoring strategy and random themed names (Blaze, Nova, Pixel, …)
- **House rules**: Stack Draw Cards, Draw Until Match, Force Play, Seven-O (7 = swap hands, 0 = rotate all hands)
- **Optional accounts** via Google or GitHub OAuth — sign in to reserve your display name and track wins/losses; guests still play freely
- **Chat** in both the waiting room and during the game, with a normalized profanity filter that catches leet-speak, diacritics, dot/space-separated bypasses
- **Host controls**: start game, add/remove bots, configure house rules, kick players, end game early, toggle room visibility
- Seamless reconnect — heartbeat detects dead sockets, transient disconnects auto-rejoin without losing your hand
- **Quality of life**: hand auto-sort toggle, pulsing UNO button, mute toggle, share-link copy, mobile-friendly layout
- HTTPS via Nginx Proxy Manager

## Quick Start (Docker)

```bash
docker compose up -d
```

The game runs on **port 5050** internally. A Postgres container is provisioned for accounts/stats/chat history. Nginx Proxy Manager admin is on **port 81** (default login: `admin@example.com` / `changeme`).

### Optional: enable OAuth sign-in

Create a `.env` next to `docker-compose.yml`:

```env
PUBLIC_URL=https://your.domain.com
SESSION_SECRET=long-random-string-here
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Configure callback URLs in your provider consoles:
- Google: `${PUBLIC_URL}/auth/google/callback`
- GitHub: `${PUBLIC_URL}/auth/github/callback`

Restart with `docker compose up -d`. If you skip this, the lobby simply hides the sign-in buttons and everyone plays as a guest.

### Self-Signed TLS (until Let's Encrypt)

```bash
./nginx/setup-npm.sh your.domain.com
```

Generates a self-signed certificate and configures NPM to proxy HTTPS → game server. When you have a domain pointed at this server, switch to Let's Encrypt in the NPM admin panel (edit proxy host → SSL → Request a new certificate).

## Development

```bash
npm install
npm run dev       # node --watch — auto-restarts on file change
# or
node server.js
```

If `DATABASE_URL` is unset the server runs in **degraded mode**: no accounts, no stats, no chat persistence. Game/lobby still work fully. To run the DB locally without docker-compose, point at any reachable Postgres:

```bash
DATABASE_URL=postgres://user:pass@localhost/uno node server.js
```

Run tests with `node --test tests/`.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | Node.js + Express + `ws` |
| Frontend | Vanilla HTML / CSS / JS (no build step) |
| Real-time | WebSockets (with ping/pong heartbeat) |
| Live state | In-memory (`Map` of rooms) |
| Persistence | Postgres (accounts, sessions, chat history, game results) |
| Auth | Hand-rolled OAuth2 — Google + GitHub |
| Proxy | Nginx Proxy Manager (Docker) |

## Project Structure

```
├── server.js              # HTTP + WebSocket server, message router, bot execution
├── auth/
│   └── oauth.js           # Hand-rolled OAuth2 (Google + GitHub) + session cookie
├── db/
│   ├── index.js           # pg Pool, migrate(), degraded-mode fallback
│   ├── users.js           # upsertUser, sessions, getStats
│   ├── chat.js            # persisted chat for logged-in users
│   ├── results.js         # game_results writes
│   └── migrations/        # *.sql, run in order on boot
├── game/
│   ├── deck.js            # 108-card deck creation and shuffle
│   ├── gameState.js       # All UNO game logic (pure-ish functions on room state)
│   ├── room.js            # Room/player lifecycle, bot management
│   ├── bot.js             # Bot AI — card scoring, color choice, swap targeting
│   └── profanity.js       # Normalized profanity filter (leet, diacritics, separators)
├── public/
│   ├── index.html         # Lobby, waiting room, game screen
│   ├── style.css          # Card visuals, layout, modals, mobile
│   ├── client.js          # WebSocket client, rendering, event handling
│   └── sounds/            # optional .mp3 effects (see sounds/README.md)
├── tests/
│   └── profanity.test.js  # node:test — bypass + false-positive coverage
├── Dockerfile
├── docker-compose.yml     # uno + db + nginx-proxy-manager
└── nginx/
    └── setup-npm.sh       # One-shot script: TLS cert + NPM proxy host
```

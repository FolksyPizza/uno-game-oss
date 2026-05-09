# UNO — Multiplayer Card Game

Real-time multiplayer UNO card game built with Node.js and WebSockets. Up to 8 players (humans + bots) per room.

## Features

- Create or join rooms with random 4-letter codes
- **Public rooms** — mark a room as public and it appears in the in-lobby room browser; private by default
- Full UNO rules: Skip, Reverse, Draw Two, Wild, Wild Draw Four
- **CPU bots** with adaptive card-scoring strategy and random themed names (Blaze, Nova, Pixel, …)
- **House rules**: Stack Draw Cards, Draw Until Match, Force Play, Seven-O (7 = swap hands, 0 = rotate all hands)
- **Chat** in both the waiting room and during the game, with a profanity filter on all messages and usernames
- **Host controls**: start game, add/remove bots, configure house rules, kick players, end game early, toggle room visibility
- Seamless reconnect — disconnecting mid-game skips your turns; rejoining by name restores your hand
- HTTPS via Nginx Proxy Manager

## Quick Start (Docker)

```bash
docker compose up -d
```

The game runs on **port 5050** internally. Nginx Proxy Manager admin is on **port 81** (default login: `admin@example.com` / `changeme`).

### Self-Signed TLS (until Let's Encrypt)

```bash
./nginx/setup-npm.sh your.domain.com
```

Generates a self-signed certificate and configures NPM to proxy HTTPS → game server. When you have a domain pointed at this server, switch to Let's Encrypt in the NPM admin panel (edit proxy host → SSL → Request a new certificate).

## Development

```bash
npm install
node server.js   # http://localhost:5050
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | Node.js + Express + `ws` |
| Frontend | Vanilla HTML / CSS / JS (no build step) |
| Real-time | WebSockets |
| State | In-memory (`Map` of rooms) |
| Proxy | Nginx Proxy Manager (Docker) |

## Project Structure

```
├── server.js          # HTTP + WebSocket server, message router, bot execution
├── game/
│   ├── deck.js        # 108-card deck creation and shuffle
│   ├── gameState.js   # All UNO game logic (pure-ish functions on room state)
│   ├── room.js        # Room/player lifecycle, bot management, disconnect handling
│   ├── bot.js         # Bot AI — card scoring, color choice, swap targeting
│   └── profanity.js   # Chat filter and username validator
├── public/
│   ├── index.html     # Lobby, waiting room, game screen
│   ├── style.css      # Card visuals, layout, modals
│   └── client.js      # WebSocket client, rendering, event handling
├── Dockerfile
├── docker-compose.yml
└── nginx/
    └── setup-npm.sh   # One-shot script: TLS cert + NPM proxy host
```

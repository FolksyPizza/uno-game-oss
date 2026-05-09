# UNO — Multiplayer Card Game

Real-time multiplayer UNO card game with WebSockets. Up to 8 players (humans + bots) per room.

## Features
- Create / join rooms with random 4-letter codes
- Full UNO rules: Skip, Reverse, Draw Two, Wild, Wild Draw Four
- CPU bots with adaptive strategy
- Chat with profanity filter
- House rules: Stack Draw Cards, Draw Until Match, Force Play, Seven-O
- Reconnect on disconnect / page refresh
- HTTPS via Nginx Proxy Manager

## Quick Start (Docker)

```bash
docker compose up -d
```

Game runs on **port 5050**. Nginx Proxy Manager admin on **port 81** (default login: `admin@example.com` / `changeme`).

### Self-Signed TLS (until Let's Encrypt)

```bash
./nginx/setup-npm.sh your.domain.com
```

This generates a self-signed certificate and configures NPM to proxy HTTPS traffic to the game server. When you have a domain with DNS pointed at this server, switch to Let's Encrypt via the NPM admin panel.

## Manual / Development

```bash
npm install
node server.js        # runs on port 5050
```

## Tech Stack
- **Backend**: Node.js + Express + `ws` WebSockets
- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **Proxy**: Nginx Proxy Manager (Docker)
- **State**: In-memory only

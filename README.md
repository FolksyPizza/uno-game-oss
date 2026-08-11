# Rosemont Games

A real-time multiplayer card-game hub built with Node.js and WebSockets. It currently includes UNO, Texas Hold'em, and official two-player Gin Rummy.

## Features

- **UNO** — multiplayer rooms, CPU bots, public browsing, official action cards, and optional Stack Draw, Draw Until Match, Force Play, and Seven-O rules
- **Texas Hold'em** — room-based no-limit tables with blinds, betting streets, showdown evaluation, and side pots
- **Gin Rummy** — official two-player draw/discard play, exact meld and layoff solving, knock/gin/undercut scoring, full match bonuses, and three fair CPU levels
- **Optional accounts** via Google or GitHub OAuth — sign in to reserve your display name and track wins/losses; guests still play freely
- Shared friends, direct messages, game invites, chat moderation, public rooms, and live activity counts
- Reconnect-safe in-memory matches with heartbeat-based connection detection
- Responsive, accessible browser clients with no frontend build step

## Quick Start (Docker)

```bash
docker compose up -d
```

Docker starts Postgres plus the hub on `5060`, UNO on `5050`, Hold'em on `5070`, and Gin Rummy on `5080`. The checked-in Nginx configuration mounts the games at `/uno/`, `/holdem/`, and `/ginrummy/`.

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

### Production routing

```bash
sudo cp nginx/rosemont-platform.conf /etc/nginx/sites-available/rosemont-platform
sudo nginx -t && sudo systemctl reload nginx
```

The Nginx configuration proxies each game subpath, including WebSocket upgrades, and routes `join.rosemont.place/ginrummy/CODE` short links into Gin Rummy rooms. See `nginx/SUBDOMAINS.md` for DNS and certificate setup.

## Development

```bash
npm install
npm run hub
npm run uno
npm run holdem
npm run ginrummy
```

If `DATABASE_URL` is unset the server runs in **degraded mode**: no accounts, no stats, no chat persistence. Game/lobby still work fully. To run the DB locally without docker-compose, point at any reachable Postgres:

```bash
DATABASE_URL=postgres://user:pass@localhost/uno npm run ginrummy
```

Run the full suite with `npm test`.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | Node.js + Express + `ws` |
| Frontend | Vanilla HTML / CSS / JS (no build step) |
| Real-time | WebSockets (with ping/pong heartbeat) |
| Live state | In-memory (`Map` of rooms) |
| Persistence | Postgres (accounts, sessions, chat history, game results) |
| Auth | Hand-rolled OAuth2 — Google + GitHub |
| Proxy | Nginx |

## Project Structure

```
├── core/                  # Shared auth, Postgres, social, moderation, notifications
├── hub/                   # Catalog and central social UI (:5060)
├── games/
│   ├── uno/               # UNO service, browser client, engine, and tests (:5050)
│   ├── holdem/            # Texas Hold'em service and client (:5070)
│   └── ginrummy/          # Gin service, client, solver, bots, and tests (:5080)
├── docker-compose.yml     # Hub, all game services, and Postgres
└── nginx/                 # Production subpath and short-link routing
```

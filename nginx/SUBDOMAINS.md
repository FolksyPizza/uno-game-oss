# Rosemont Games — subdomain map & DNS

One apex (`rosemont.place`), multiple subdomains. Each user-facing subdomain =
one A record + one Let's Encrypt cert + one nginx server block. `id`/`api`/`ws`/`cdn`
are distinct **origins** (own cert, own CORS/cache policy) that currently proxy to
the **hub container (:5060)** — split into separate containers later by repointing
the nginx block, with no client changes.

## Subdomains

| Subdomain                 | Role                                            | Upstream        |
|---------------------------|-------------------------------------------------|-----------------|
| `gamehub.rosemont.place`  | Hub — catalog, landing                          | hub  `:5060`    |
| `id.rosemont.place`       | Central auth / OAuth callback / session issue   | hub  `:5060`    |
| `api.rosemont.place`      | Shared social REST (friends, DMs, stats)        | hub  `:5060`    |
| `ws.rosemont.place`       | Global notification socket (invites/DMs/presence)| hub  `:5060`   |
| `cdn.rosemont.place`      | Static assets (cacheable origin)                | hub  `:5060`    |
| `uno.rosemont.place`      | UNO game (already provisioned)                  | uno  `:5050`    |
| `<game>.rosemont.place`   | Future games: poker, ginrummy, blackjack, …     | game `:50xx`    |

## DNS records to set (before provisioning)

Point each at this instance's public IP (same IP `uno` already uses):

```
gamehub  A  <instance-ip>
id       A  <instance-ip>
api      A  <instance-ip>
ws       A  <instance-ip>
cdn      A  <instance-ip>
# uno — already pointed
```

Get the instance IP with:  `curl -s ifconfig.me`

## Provision (after DNS resolves here)

```bash
# all platform subdomains at once
sudo CERTBOT_EMAIL=william.h.wagg@gmail.com nginx/provision-all.sh

# or one at a time
sudo nginx/provision-subdomain.sh gamehub 5060
```

certbot uses HTTP-01, so each name must already resolve to this box or cert
issuance fails.

## Notes

- **OAuth redirect URI** is fixed at `https://id.rosemont.place/auth/google/callback`.
  Whitelist it once in the Google console; adding games never touches it again.
- **Session cookie** is `Domain=.rosemont.place` so every subdomain (including
  `cdn`) shares one login. Truly cookieless assets would need a separate apex —
  deferred until asset volume justifies it.
- **CORS**: `api` and `ws` allow an explicit origin allowlist (gamehub, uno,
  future games) with `Access-Control-Allow-Credentials: true` — never `*`.

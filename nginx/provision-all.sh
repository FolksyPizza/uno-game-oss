#!/usr/bin/env bash
# Rosemont Games — provision every platform subdomain in one shot.
#
# Run AFTER the A records below are pointed at this instance. Each entry is
# "<subdomain> <upstream_port>". id/api/ws/cdn all proxy to the hub (5060) for
# now — distinct origins (own cert + nginx block + CORS/cache policy), one
# process. Repoint a block to a new container later with zero client changes.
#
# uno.rosemont.place is already provisioned and is intentionally omitted.
set -euo pipefail
HERE="$(dirname "$(readlink -f "$0")")"

# subdomain  port
SUBDOMAINS=(
  "gamehub 5060"   # catalog + landing
  "id      5060"   # central auth / OAuth callback / session issue
  "api     5060"   # shared social REST (friends, DMs, stats, presence)
  "ws      5060"   # global notification socket
  "cdn     5060"   # static assets (cacheable origin)
)

for entry in "${SUBDOMAINS[@]}"; do
  read -r sub port <<< "$entry"
  echo
  echo "########## ${sub}.rosemont.place ##########"
  "${HERE}/provision-subdomain.sh" "$sub" "$port"
done

echo
echo "All platform subdomains provisioned."

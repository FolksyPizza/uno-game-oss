#!/usr/bin/env bash
# Rosemont Games — provision one subdomain: nginx server block + Let's Encrypt cert.
#
# Usage:  sudo ./provision-subdomain.sh <subdomain> <upstream_port>
#   e.g.  sudo ./provision-subdomain.sh gamehub 5060
#         sudo ./provision-subdomain.sh id      5060
#
# Prereq: the DNS A record for <subdomain>.rosemont.place must already point at
# this instance (certbot uses HTTP-01, so the name has to resolve here first).
#
# Idempotent: re-running renders the block and asks certbot to expand/renew.
set -euo pipefail

DOMAIN_ROOT="rosemont.place"
TEMPLATE="$(dirname "$(readlink -f "$0")")/site.template.conf"
SITES_AVAILABLE="/etc/nginx/sites-available"
SITES_ENABLED="/etc/nginx/sites-enabled"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-william.h.wagg@gmail.com}"

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <subdomain> <upstream_port>" >&2
  exit 64
fi
SUB="$1"; PORT="$2"
FQDN="${SUB}.${DOMAIN_ROOT}"
CONF="${SITES_AVAILABLE}/${FQDN}"

if [[ $EUID -ne 0 ]]; then
  echo "error: must run as root (sudo)" >&2
  exit 1
fi
if [[ ! -f "$TEMPLATE" ]]; then
  echo "error: template not found at $TEMPLATE" >&2
  exit 1
fi

echo "==> Rendering nginx block for ${FQDN} -> 127.0.0.1:${PORT}"
sed -e "s/__SERVER_NAME__/${FQDN}/g" \
    -e "s/__UPSTREAM_PORT__/${PORT}/g" \
    "$TEMPLATE" > "$CONF"

ln -sf "$CONF" "${SITES_ENABLED}/${FQDN}"

echo "==> Testing nginx config"
nginx -t
systemctl reload nginx

echo "==> Requesting Let's Encrypt cert (HTTP-01) for ${FQDN}"
certbot --nginx -d "$FQDN" \
  --non-interactive --agree-tos --redirect \
  -m "$CERTBOT_EMAIL"

echo "==> Reloading nginx"
systemctl reload nginx
echo "==> Done: https://${FQDN}  ->  127.0.0.1:${PORT}"

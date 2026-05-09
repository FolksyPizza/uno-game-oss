#!/usr/bin/env bash
# Configures Nginx Proxy Manager with a self-signed TLS cert for the UNO game.
# Run this ONCE after `docker compose up -d` and NPM has fully started.
#
# Usage: ./nginx/setup-npm.sh [domain] [npm-url]
#   domain   hostname/IP to proxy (default: localhost)
#   npm-url  NPM admin URL        (default: http://localhost:81)

set -euo pipefail

DOMAIN="${1:-localhost}"
NPM_URL="${2:-http://localhost:81}"
SSL_DIR="$(dirname "$0")/ssl"
CERT_FILE="$SSL_DIR/self-signed.crt"
KEY_FILE="$SSL_DIR/self-signed.key"

echo "==> Generating self-signed TLS certificate for: $DOMAIN"
mkdir -p "$SSL_DIR"
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -subj "/C=US/ST=State/L=City/O=UNO Game/CN=$DOMAIN" \
  -addext "subjectAltName=DNS:$DOMAIN,IP:127.0.0.1" 2>/dev/null
echo "    Certificate: $CERT_FILE"
echo "    Private key: $KEY_FILE"

echo "==> Waiting for NPM to be ready at $NPM_URL ..."
for i in $(seq 1 30); do
  if curl -sf "$NPM_URL/api/" > /dev/null 2>&1; then break; fi
  echo "    attempt $i/30 ..."
  sleep 5
done

echo "==> Authenticating with NPM (default credentials)"
TOKEN=$(curl -sf -X POST "$NPM_URL/api/tokens" \
  -H "Content-Type: application/json" \
  -d '{"identity":"admin@example.com","secret":"changeme"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not authenticate. If this is a first run, NPM may need initial setup."
  echo "  1. Visit $NPM_URL and log in with admin@example.com / changeme"
  echo "  2. Set a new password when prompted, then re-run this script."
  exit 1
fi

echo "==> Uploading self-signed certificate"
CERT_ID=$(curl -sf -X POST "$NPM_URL/api/nginx/certificates" \
  -H "Authorization: Bearer $TOKEN" \
  -F "certificate=@$CERT_FILE" \
  -F "certificate_key=@$KEY_FILE" \
  -F "name=uno-self-signed" \
  -F "provider=other" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || true)

echo "    Certificate ID: $CERT_ID"

echo "==> Creating proxy host: $DOMAIN → http://uno:5050"
PROXY_ID=$(curl -sf -X POST "$NPM_URL/api/nginx/proxy-hosts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"domain_names\": [\"$DOMAIN\"],
    \"forward_scheme\": \"http\",
    \"forward_host\": \"uno\",
    \"forward_port\": 5050,
    \"ssl_forced\": true,
    \"certificate_id\": $CERT_ID,
    \"allow_websocket_upgrade\": true,
    \"block_exploits\": true
  }" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || true)

echo "    Proxy host ID: $PROXY_ID"
echo ""
echo "✅  Done! UNO is now available at: https://$DOMAIN"
echo ""
echo "    ⚠  Browsers will warn about the self-signed certificate."
echo "       Proceed anyway, or import $CERT_FILE into your OS/browser trust store."
echo ""
echo "    When ready for Let's Encrypt:"
echo "      1. Point your domain's DNS to this server."
echo "      2. In NPM admin ($NPM_URL), edit the proxy host."
echo "      3. Change SSL to 'Request a new SSL certificate' (Let's Encrypt)."

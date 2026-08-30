#!/usr/bin/env bash
# Node 24+ and nothing else. No install step — everything is bundled.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HERE/logs"

LANDING=${LANDING_PORT:-8080}; PORTAL=${PORTAL_PORT:-8081}; FIELD=${FIELD_PORT:-8082}
# Internal only. Keep these closed at the firewall — see DEPLOY.md.
MOCK=${MOCK_PORT:-4010}; BFF=${BFF_PORT:-4000}

for port in "$MOCK" "$BFF" "$LANDING" "$PORTAL" "$FIELD"; do
  if ss -ltn 2>/dev/null | grep -q ":$port "; then
    echo "port $port is already in use."
    echo "Set MOCK_PORT / BFF_PORT / LANDING_PORT / PORTAL_PORT / FIELD_PORT to free ones."
    exit 1
  fi
done

trap 'kill 0' EXIT INT TERM
MOCK_PORT="$MOCK" node "$HERE/engine-mock/tools/mock.mjs" > "$HERE/logs/mock.log" 2>&1 &
BFF_PORT="$BFF" API_BASE_URL="http://127.0.0.1:$MOCK" node "$HERE/bff.mjs" > "$HERE/logs/bff.log" 2>&1 &
BFF_PORT="$BFF" LANDING_PORT="$LANDING" PORTAL_PORT="$PORTAL" FIELD_PORT="$FIELD" \
  node "$HERE/serve.mjs" > "$HERE/logs/serve.log" 2>&1 &

# Probe the whole chain on BOTH app origins: a GraphQL round-trip only answers
# if serve → bff → fixtures are all actually up. Static files alone prove nothing.
ok() { curl -s --max-time 2 -X POST "http://127.0.0.1:$1/graphql" \
        -H 'content-type: application/json' -d '{"query":"{__typename}"}' | grep -q '"Query"'; }
for _ in $(seq 25); do
  sleep 1
  if ok "$PORTAL" && ok "$FIELD" && curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$LANDING/"; then
    echo "up"
    echo "  landing        :$LANDING"
    echo "  command centre :$PORTAL"
    echo "  field app      :$FIELD"
    wait
  fi
done
echo "stack did not come up — see $HERE/logs/"; exit 1

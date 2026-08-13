#!/usr/bin/env bash
# start.sh — build and start the full Logbook Docker stack (app, redis, minio, nginx).
# Postgres stays on the host (see README) — make sure it's running before this.
set -e

docker compose up -d --build

echo
echo "✓ Logbook stack started"
echo "  App:   http://localhost:3737"
echo "  HTTPS: https://logbook.local (requires nginx/certs — see README's HTTPS section)"
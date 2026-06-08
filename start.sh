#!/usr/bin/env bash
# start.sh — start the Logbook Node.js server
set -e

cd "$(dirname "$0")"

export PORT=3737
export BASE_PATH=
export DATA_DIR=./data

# Optional Todoist sync (leave empty to disable)
export TODOIST_API_TOKEN=
export TODOIST_PROJECT_ID=

echo "Starting Logbook on http://localhost:${PORT}${BASE_PATH}/"
exec node server.js

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -d ./attestor-core ]; then
  echo "Starting attestor-core from source clone (port 8001)..."
  if [ -f .env ]; then
    set -a
    source .env
    set +a
  else
    echo "WARNING: attestor/.env not found — attestor will fail without PRIVATE_KEY"
  fi
  cd ./attestor-core
  npm run start
else
  echo "No ./attestor-core clone found — starting via docker compose."
  docker compose up
fi

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

docker compose up -d

echo "Waiting for node and indexer to become healthy..."
for svc in node indexer; do
  for _ in $(seq 1 60); do
    status=$(docker compose ps "$svc" --format json 2>/dev/null | grep -o '"Health": *"[^"]*"' | cut -d'"' -f4 || true)
    [ "$status" = "healthy" ] && break
    sleep 2
  done
  echo "  $svc: $(docker compose ps "$svc" --format json 2>/dev/null | grep -o '"Health": *"[^"]*"' | cut -d'"' -f4 || true)"
done

echo ""
echo "Devnet up:"
echo "  node        http://127.0.0.1:9944"
echo "  indexer     http://127.0.0.1:8088 (GraphQL /api/v4/graphql)"
echo "  proof server http://127.0.0.1:6300"

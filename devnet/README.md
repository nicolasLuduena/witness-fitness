# Devnet — local Midnight network (node + indexer + proof server)

Copied from the reference app (`midnight-reference-app/compose.yml`): a ready
local devnet with healthchecks. Same pinned images (see AGENTS.md §4):

- `midnightntwrk/midnight-node:0.22.5` (port 9944)
- `midnightntwrk/indexer-standalone:4.2.1` (port 8088)
- `midnightntwrk/proof-server:8.1.0` (port 6300)

## Usage

```bash
./up.sh      # docker compose up -d, waits for healthchecks
./down.sh    # docker compose down
```

Or from the repo root: `pnpm devnet:up` / `pnpm devnet:down`.

## Endpoints

| Service | URL |
|---|---|
| Node RPC | `ws://127.0.0.1:9944` |
| Indexer REST/GraphQL | `http://127.0.0.1:8088` |
| Proof server | `http://127.0.0.1:6300` |

`standalone.env.example` is the indexer container's env file (dev defaults,
committed on purpose — no secrets).

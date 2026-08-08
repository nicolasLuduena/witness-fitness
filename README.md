# WitnessFitness

**On-chain Strava — provably-private fitness challenges on Midnight.**

Real workouts are attested from a real API (Strava) via a self-hosted Reclaim attestor; 2-of-3 notary signers re-sign claims in Midnight-verifiable Jubjub-Schnorr; a single Midnight contract verifies signatures, vaults credentials, and runs wager / streak / badge mechanics over sealed data.

Demo tagline: **"prove the workout, hide the data."**

## Repository layout (pnpm workspaces)

```
witnessfitness/
├── pnpm-workspace.yaml            # packages: contract, api, notary, client, ui, devnet
├── package.json                   # root, private
├── tsconfig.base.json
├── AGENTS.md                      # master plan — EVERY agent reads this first
├── docs/                          # architecture + per-agent specs (this directory)
├── packages/
│   ├── contract/                  # Compact contract + witnesses + vitest (simulator)
│   ├── api/                       # Contract TS wrapper (SentinelContract pattern)
│   ├── notary/                    # Notary Signer (run 3 instances)
│   └── client/                    # zk-fetch prover flow (Strava OAuth → proof)
├── attestor/                      # self-hosted Reclaim stack
├── ui/                            # React + Vite demo frontend
├── devnet/                        # compose.yml (node+indexer+proof-server) + up/down scripts
└── README.md
```

Full layout with files: `AGENTS.md` §5.

## Prerequisites

- **Reference project (pattern + versions source of truth):** `/home/batman/Documents/txpipe-shop/midnight-reference-app` — use its `VERSIONS.md` pinned deps, its `compose.yml` as the devnet, and its provider/wrapper/witness patterns. See `AGENTS.md` §4.
- Node.js 20+ (reference pins 24.13.1), pnpm (reference pins 10.29.3), Docker (devnet + attestor).
- A Strava developer app (client ID/secret) and an OAuth token for a test athlete (free, strava.com/developers).

Attestation-side npm packages (versions confirmed 2026-08): `@reclaimprotocol/attestor-core@5.0.8`, `@reclaimprotocol/zk-fetch@1.1.0`.

## Quickstart

```bash
pnpm install
cp ../txpipe-shop/midnight-reference-app/compose.yml devnet/   # or copy once at scaffold time
pnpm devnet:up        # docker compose up: node + indexer + proof server
pnpm dev:contract     # compile contracts + run simulator tests
pnpm dev:attestor     # self-hosted Reclaim attestor (see attestor/README.md)
pnpm dev:notary       # notary signer (3 instances, see packages/notary/.env.sample)
pnpm dev:client       # zk-fetch prover flow (Strava OAuth → proof)
pnpm dev:ui           # demo frontend
pnpm test             # all workspace tests
```

## Deploy a fresh contract (the manual cycle)

Run this whenever the contract source changed, or after `pnpm devnet:down`
(the compose file has **no volumes** — `down` wipes the chain and every
deployment with it). A plain machine reboot does **not** — the containers
persist, and the deployed contract survives. Prereqs: devnet up, 3 notary
instances running (see `packages/notary/.env.sample` + `.env.notary-1..3`),
attestor up.

```bash
# 1. Contract build — regenerates the ZK verifier keys (few minutes; wait for it)
cd packages/contract && pnpm build

# 2. Deploy to the devnet — pins the admin at the constructor, registers the
#    notary slots, writes packages/contract/deploy-output.json
cd packages/contract && pnpm exec tsx scripts/deploy.ts

# 3. Rotate the on-chain registry to the 3 RUNNING instances' real keys
#    (the deploy above registers demo keys; this overwrites them with the
#    /pubkey of 8101/8102/8103 and updates deploy-output.json)
cd .. && pnpm --filter @witnessfitness/contract run rotate-notaries

# 4. Wipe the sidecar's local vault and restart it — it joins the NEW
#    contract address from deploy-output.json
rm -rf packages/api/midnight-level-db
pnpm --filter @witnessfitness/api start:sidecar
curl -s http://127.0.0.1:8200/health     # wait for "ready":true

# 5. Refresh the UI's copy of the deploy artifacts, then (re)start the dev server
pnpm --filter ui copy-keys
pnpm dev:ui                               # http://localhost:5173

# 6. Full on-chain E2E — real attestations (fixtures) → wager → settle →
#    winner NFT + balance deltas. Takes ~2.5 min (waits out the settle deadline).
pnpm --filter @witnessfitness/api run e2e:wager
```

Notes:

- **Freshness window:** the deployed contract accepts attestations whose
  timestamp is within 30 days of the current block time. Old fixture proofs
  get rejected ("Timestamp too old") — regenerate them demo-morning via
  `packages/client` (Strava OAuth + the self-hosted attestor).
- **Notary instances are untouched by redeploys** — their keys live in
  `packages/notary/.env.notary-*`; only the on-chain registry (step 3) changes.
- **Admin is pinned at deploy** (constructor): the deployer's
  `admin-secret.local` (gitignored) is the only admin; there is no
  first-call race on `registerAdmin`.
- After step 6, the browser demo runs in wallet mode: connect Lace to the
  devnet, attest a real workout, challenge a second wallet by its
  holder-binding ID. Full walkthrough: `docs/DEMO-PLAYBOOK.md`.

## Documentation map

| File | Audience | Content |
|---|---|---|
| `AGENTS.md` | Everyone — start here | Vision, role glossary, architecture, environment, schedule, acceptance criteria, risks |
| `docs/ARCHITECTURE.md` | Everyone | Trust model (oracle-style, 2-of-3), data flows, signature parity rule, privacy boundary |
| `docs/CONTRACT.md` | Contract agent | Compact spec: assertion schema, ledger state, entrypoints, tests, DoD |
| `docs/ATTESTATION.md` | Attestation agent | Self-hosted Reclaim attestor, Strava OAuth, fixture proofs, fallbacks |
| `docs/NOTARY.md` | Notary/Client agent | 3-instance signer spec, verification, signing parity, API, roundtrip test |
| `docs/UI-DEMO.md` | UI/Demo agent | Screens, 7-minute demo script with fallbacks, pitch outline |

## The one rule

**Signature parity:** off-chain notary signatures must verify inside the contract circuit — the challenge hash encoding is contract law. See `docs/ARCHITECTURE.md` §4 and the mandatory roundtrip test.

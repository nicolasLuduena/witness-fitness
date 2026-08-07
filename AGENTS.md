# AGENTS.md — WitnessFitness master plan

Read this first. Everything in this document is decided. Do not re-litigate architecture decisions; escalate only if a documented fact is disproven.

## 1. Product vision

On-chain Strava: **attested, private fitness competition on Midnight.** Users prove real workouts (fetched from a real API — Strava) with ZK privacy — competing in wagers, streaks, and badges without revealing the underlying data or linking wallets.

- **Demo centerpiece (both, per decision):**
  1. **Live wager** — two athletes stake; the contract compares two sealed distances at the deadline and pays the winner. The room never sees a single number.
  2. **Streak + badge** — a sealed consecutive-day streak chain; `proveBadge` proves a feat to a third party (mock employer) without revealing any underlying data.
- **Differentiator:** attested workouts (anti-bot — the thing that killed STEPN/Sweatcoin) + privacy (sealed health data). No fake-proof path: claims are signed by an attestor that witnessed the real API interaction.
- **Business (pitch slide only):** B2B2C — employer wellness programs as the payer (per-employee pricing; the platform never sees health data = removes employer liability), consumer mechanics as the engagement flywheel.

## 2. Role glossary (do not confuse these)

| Role | What it is | Who runs it |
|---|---|---|
| **Attestor** | Reclaim's witness server (`@reclaimprotocol/attestor-core`). Intermediates the real TLS session with the target API, produces a ZK proof + signed claim. Self-hosted locally. | We run it (docker or `npm run start:tsc`, port 8001) |
| **Notary Signer** | *Our* TypeScript service (3 independent instances, 3 keys). Verifies the Reclaim proof with Reclaim's SDK, then **re-signs** the claim as a Jubjub-Schnorr assertion in *our* schema. | We run it. This is a deliberate oracle-style trust anchor |
| **Contract** | Single Midnight Compact contract. Verifies ≥2 of 3 notary signatures, freshness, nullifiers; stores sealed credentials; runs wager/streak/badge mechanics. | Deployed on local Midnight devnet |

**Why the notary signer exists:** Reclaim proofs are circom/SNARK-based and cannot be verified inside a Compact circuit (Midnight verifies Schnorr-on-Jubjub + hashes natively, not arbitrary SNARKs). The notary signer is the registered-key bridge. This is not a cross-chain bridge and effectstream is **out of scope** for this build — one chain only (Midnight).

## 3. Architecture (one diagram, authoritative)

```
  Strava API (real, OAuth)                       REAL attestation, modern TLS
        ▲              │
        │  TLS (Reclaim's own TS TLS client)
        │              ▼
  client/ (zk-fetch) ─► attestor-core (self-hosted, wss://localhost:8001/ws)
        │               │  signs claim + ZK proof of the API interaction
        │               ▼
        └── proof ─────► Notary Signers ×3 (independent instances, 3 keys)
                          │  each: verify Reclaim proof w/ Reclaim SDK
                          │  → build typed assertion (our schema, versioned)
                          │  → sign Jubjub-Schnorr (MUST match contract encoding)
                          ▼
   Midnight contract:
     registry(3 notary keys) → require ≥2 valid Schnorr sigs
     → freshness (timestamp window) + nullifier (no replay)
     → predicates over typed metric claims
     → credential vault (persistentCommit + hashToCurve holder binding)
     → wager / streak / badge mechanics (sealed, shielded payouts)
```

Full details, trust model, and privacy boundary: `ARCHITECTURE.md`.

## 4. Environment & prerequisites

### Reference project (use it as the pattern source of truth)

A **fully working Midnight project** exists at:

```
/home/batman/Documents/txpipe-shop/midnight-reference-app
```

This is the Sentinel reference app — a working Compact contract with witnesses, a TypeScript contract wrapper, wallet SDK integration, and a ready devnet stack. **Copy its proven patterns, not ours invented from scratch:**

- **Versions** — use the exact pinned versions from `VERSIONS.md` in that repo (2026-07-23: compact devtools 0.5.1, compact compiler 0.31.1, compact runtime 0.16.0, midnight-js 4.1.1, onchain-runtime 3.0.0, indexer-standalone 4.2.1, proof-server 8.1.0, midnight node 0.22.5, pnpm 10.29.3). Copy the `dependencies` block into our workspaces.
- **Devnet** — copy the reference's `compose.yml` (node + indexer-standalone + proof-server, with healthchecks) into `devnet/`; `docker compose up` is the devnet. Defaults: indexer `http://127.0.0.1:8088`, node `http://127.0.0.1:9944`, proof server `http://127.0.0.1:6300`. Wrap with `devnet/up.sh` / `devnet/down.sh`.
- **Patterns to mirror, not reinvent:**
  - `packages/contract/src/providers.ts` — provider stack (indexer, node, proof server, private state).
  - `packages/api/src/index.ts` — the `SentinelContract` wrapper class pattern (`deploy()`, typed circuit calls). Our contract wrapper goes in `packages/api`.
  - `packages/contract/src/witnesses.ts` — witness conventions.
  - Wallet SDK usage (HD wallet, shielded/dust/unshielded roles) for the demo flows.
- If the reference app's versions conflict with anything in these docs, **the reference app wins** — these docs were written against older version guesses.

### Toolchain

- Node.js 20+ (reference pins 24.13.1), pnpm (reference pins 10.29.3), Docker (devnet + attestor).
- Midnight packages: use the reference app's pinned versions (see above). Confirm `compact` CLI works (the reference's devtools version 0.5.1).
- Check whether the Compact stdlib ships `jubjubSchnorrVerify` — if yes, prefer it; the zk-loan polyfill is the known-good fallback.
- npm packages for the attestation side (versions confirmed at planning time 2026-08):
  - `@reclaimprotocol/attestor-core@5.0.8` (latest tag; beta tag exists — use latest)
  - `@reclaimprotocol/zk-fetch@1.1.0`

### Verify at build start (first hour, read-only research — these are the only open unknowns)

1. **Attestor `PRIVATE_KEY` signature scheme** (hex key — determine ECDSA/secp256k1 vs other; only affects claim parsing in the notary signer). Evidence: `attestor-core` README + `.env.sample` + `docs/run-server.md`.
2. **zk-fetch → custom attestor wiring**: exact way to point `@reclaimprotocol/zk-fetch` at `wss://localhost:8001/ws` instead of Reclaim's cloud (docs: "replace the official Reclaim attestor URL with your own"; confirm API surface + `download:zk-files` for Node).

## 5. Repository layout (pnpm workspaces — authoritative)

```
witnessfitness/
├── pnpm-workspace.yaml            # packages: contract, api, notary, client, ui, devnet
├── package.json                   # root, private
├── tsconfig.base.json
├── AGENTS.md / docs/              # these docs
├── packages/
│   ├── contract/                  # Compact contract + witnesses + vitest (simulator)
│   │   └── src/
│   │       ├── schnorr.compact    # Jubjub Schnorr (stdlib or zk-loan polyfill)
│   │       ├── assertion.compact  # versioned assertion schema + challenge hash
│   │       ├── stride.compact     # registry, verifyAttestation, wager, streak, badge, vault
│   │       └── witnesses.ts
│   ├── api/                       # Contract TS wrapper (mirror reference's SentinelContract)
│   │   └── src/index.ts           # deploy(), verifyAttestation(), wagers, streaks, badges
│   ├── notary/                    # Notary Signer (run 3 instances)
│   │   ├── src/{index,verify-reclaim,assert,sign,config}.ts
│   │   ├── tests/
│   │   └── .env.sample            # NOTARY_KEY, ATTESTOR_URL, PORT, CONTRACT_ADDRESS
│   └── client/                    # zk-fetch prover flow (Strava OAuth → proof)
│       ├── src/{index,strava,attest}.ts
│       └── fixtures/              # pre-generated fixture proofs (fallback + tests)
├── attestor/                      # self-hosted Reclaim stack
│   ├── docker-compose.yaml
│   ├── .env.sample                # PRIVATE_KEY etc.
│   └── README.md
├── ui/                            # React + Vite demo frontend
│   └── src/
├── devnet/                        # copy reference app's compose.yml (node+indexer+proof-server)
│   ├── compose.yml                # from midnight-reference-app (healthchecks included)
│   ├── up.sh / down.sh
│   └── README.md
└── README.md
```

Root `package.json` scripts: `dev:contract`, `dev:notary`, `dev:client`, `dev:ui`, `devnet:up`, `devnet:down`, `test` (runs all workspace tests).

## 6. Milestones & agent assignments (48h)

| Block | Contract agent | Attestation agent | Notary/Client agent | UI/Demo agent |
|---|---|---|---|---|
| **D1 AM** | Repo scaffold (shared); devnet up; `schnorr.compact` + `assertion.compact` compile; build-start verification #1 results | `attestor-core` running locally; Strava app + OAuth token; first raw proof | Build-start verification #2 (zk-fetch wiring); claim-format research (attestor signature scheme) | UI shell (wager screen, sealed-envelope visuals) |
| **D1 PM** | `verifyAttestation` + registry + vault in `stride.compact`; simulator tests | End-to-end proof from a real Strava call; save 2+ fixture proofs | Notary Signer: `verify-reclaim` path (against attestation agent's proofs) | Wire client→contract flow stubs |
| **D2 AM** | Wager + settle + nullifiers; streak + badges; simulator tests | 2 more fixture proofs (different athletes, for the wager) | Notary Signer: sign + 2-of-3 output; roundtrip signature test vs contract | Live wager UI + sealed reveal animation |
| **D2 PM** | Full test pass; demo-mode hardening | Fallback rehearsed (fixture replay) | Full E2E: Strava → contract, 2 signatures | Demo script + pitch (B2B2C) |

**Hard dependencies:** Notary/Client needs (a) the contract's compiled `pureCircuits` for signing parity, or an exact reimplementation, and (b) attestation agent's proofs. UI needs the contract ABI. Coordinate on Day 1 PM — do not let the notary signer serialize the critical path.

## 7. Acceptance criteria (definition of done)

1. Contract simulator tests green: 2-of-3 valid signatures accepted; 1-of-3 rejected; tampered assertion rejected; nullifier replay blocked; stale timestamp blocked; wager settles correctly (both-submit, forfeit, deadline); streak advance/reset/mint boundaries; `proveBadge` verifies without revealing data.
2. E2E: real Strava attestation → 2 notary signatures → on-chain `verifyAttestation` → vaulted credential.
3. Live wager settles with sealed comparison; stake accounting correct; replay attempt fails.
4. Streak chain + badge minted; `proveBadge` verified by a mock third party.
5. Demo script with fallback triggers rehearsed end-to-end; pitch slides drafted.
6. Secrets only in `.env` files, never committed.

## 8. Top risks & mitigations

- **Reclaim live-session flakiness** → pre-generated fixture proofs replayed (identical crypto path). Mitigate by saving fixtures early (D1 PM). **Fixture freshness:** the contract's attestation freshness window will reject stale fixtures — set the window to ≥30 days for the demo build, and **regenerate the fixture proofs the morning of the demo**. Verify fixture re-verifiability offline in the notary's verify step.
- **Fallback becoming the primary path** → rehearse the live route daily; fixture mode is for rescue, not habit.
- **Signature parity bug** (signatures that don't verify in-circuit) → sign→verify roundtrip test on the simulator BEFORE wiring anything else. See `ARCHITECTURE.md` §4.
- **SHA-256 (`persistentCommit`) circuit cost** → keep assertion structs small; challenge hashing via `transientHash` (Poseidon).
- **Schnorr stdlib uncertainty** → zk-loan polyfill is known-good; swap only if `jubjubSchnorrVerify` exists in compact 0.4.0 and is tested.
- **No cross-contract calls on Midnight** → single contract, by design.

## 9. Working rules

- pnpm workspaces; strict TypeScript; no code comments unless they carry information (per repo convention); no secrets in git.
- Midnight concepts (Compact, circuits, witnesses, simulator, devnet) are assumed knowledge — use your Midnight skills, not these docs, for framework questions.
- This build is demo-first: reliability and a rehearsed fallback beat feature count.

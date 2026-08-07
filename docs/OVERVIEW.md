# OVERVIEW.md — WitnessFitness for newcomers

## The pitch

**Prove the workout, hide the data.** WitnessFitness is on-chain Strava on
Midnight: a real workout (fetched from the real Strava API) is turned into a
cryptographic proof that the contract accepts *without ever seeing a single
number* — then two athletes wager on sealed distances, streaks chain up sealed
days, and badges are proven to a mock employer without revealing the underlying
data or linking wallets.

## Why it exists

- **Anti-bot attestation** — workouts are signed by an attestor that witnessed
  the real TLS session with Strava's API. No fake-proof path: this is the
  thing that killed STEPN/Sweatcoin, solved.
- **Privacy** — the chain sees commitments, not heartbeats. A wager settles by
  comparing two sealed distances; the room never sees either value.
- **Business (pitch slide)** — B2B2C: employer wellness programs pay per
  employee; the platform never touches health data, which removes employer
  liability. Consumer competition is the engagement flywheel.

## The three roles (who runs what)

| Role | What it is | Who runs it |
|---|---|---|
| **Attestor** | Reclaim's witness server (`attestor/`, port 8001). Intermediates the real TLS session with Strava, produces a ZK proof + signed claim. | We run it (`pnpm dev:attestor`) |
| **Notary Signers** | Our TypeScript service, 3 independent instances (ports 8101–8103, 3 keys). Verify the Reclaim proof with Reclaim's own SDK, then re-sign the claim as a Jubjub-Schnorr assertion in our schema. | We run it (`pnpm --filter @witnessfitness/notary start:instances`) |
| **Contract** | One Midnight Compact contract (`stride.compact`): registry, verification, vault, wager/streak/badge mechanics. | Deployed on the local devnet |

## Why the notary bridge exists

Reclaim proofs are circom/SNARK-based and **cannot be verified inside a Compact
circuit** — Midnight verifies Schnorr-on-Jubjub and hashes natively, not
arbitrary SNARKs. The notary signers are the registered-key bridge: three
independent services re-sign each verified claim with a scheme the circuit
*can* check. This is a deliberate oracle-style trust anchor, not a bridge —
one chain only (Midnight).

## End-to-end flow

```
Strava API ──TLS──► client/ (zk-fetch) ──► attestor-core (wss://localhost:8001/ws)
   │                                              │ signs claim + ZK proof
   └──────────── proof ──────────────────────────► Notary Signers ×3 (8101–8103)
                                                    each: verify w/ Reclaim SDK
                                                    → build typed assertion → sign Jubjub-Schnorr
                                                    ▼
                    Midnight contract: registry (≥2 of 3 sigs) → freshness + nullifier
                    → vault (persistentCommit + hashToCurve holder binding)
                    → wager / streak / badge mechanics over sealed data
```

## How it uses Midnight's features

- **ZK-native transitions** — every entrypoint (`verifyAttestation`,
  `settleWager`, …) is a zero-knowledge transition; witnesses stay private.
- **`disclose()` privacy model** — witness data is hidden by default; only
  `disclose()`-d values (bindings, commitments, timestamps) reach the ledger.
- **Native crypto, all in-circuit** — Jubjub-Schnorr verify
  (`schnorr.compact`), `hashToCurve` (holder binding), `persistentCommit`
  (SHA-256 vault keys), `transientHash` (Poseidon challenges),
  `transientCommit` (sealed wager submissions).
- **Nullifier pattern** — nonce nullifier blocks credential replay;
  per-wager nullifier stops double-counting one workout in a challenge.
- **In-circuit chain time** — `blockTimeGte`/`blockTimeLt` drive the 30-day
  freshness window, wager deadlines and the 60 s settle grace.
- **Deferred (decided, not built)** — shielded stakes (demo uses ledger
  balances; shielded sends are the prod design) and MerkleTree badge sets
  (demo uses a `Set` per holder).

## Current status (2026-08-07, verified)

- **87 tests green** — contract 35, notary 23, api 21, ui 8 (`pnpm test`).
- **Live stack running** — devnet (node 9944, indexer 8088, proof server
  6300), attestor `ws://localhost:8001/ws`, notaries 8101–8103, demo sidecar
  `:8200` `ready:true`.
- **Contract deployed** — `876edadee…6df0`, 30-day freshness window, 3 notary
  keys rotated on-chain. Live E2E attest→vault green (tx `7382c9ef…`).
- **One human action left** — Strava is a **free API** (strava.com/developers,
  no payment): paste the Client ID/Secret into `packages/client/.env`, run
  `pnpm dev:client auth`, then `fixtures 3` to close the fixture gate. The
  pipeline is already proven with public-API fixture proofs.

## How to run it

```bash
pnpm install
pnpm devnet:up                      # node + indexer + proof server (docker)
pnpm dev:attestor                   # attestor, ws://localhost:8001/ws
pnpm --filter @witnessfitness/notary start:instances   # 8101/8102/8103
pnpm --filter @witnessfitness/contract run deploy      # deploy + admin-secret.local
pnpm --filter @witnessfitness/contract run rotate-notaries  # register instance keys
pnpm --filter @witnessfitness/api start:sidecar        # :8200 (live UI mode)
pnpm dev:ui                          # http://localhost:5173 (?mode=live)
pnpm test                            # all workspace tests
```

Full details: `KEY-RECOVERY.md` (secrets/keys from scratch), `ui/README.md`
(demo script).

## Documentation map

| File | What it's for |
|---|---|
| `AGENTS.md` | Master plan — everyone starts here |
| `README.md` | Repo quickstart |
| `ARCHITECTURE.md` | Trust model, signature-parity law, privacy boundary |
| `CONTRACT.md` / `ATTESTATION.md` / `NOTARY.md` / `UI-DEMO.md` | Per-workstream specs |
| `PITCH.md` | Business slide |
| `OVERVIEW.md` / `GLOSSARY.md` / `KEY-RECOVERY.md` | Newcomer intro, plain-English crypto, keys from scratch |

## The one rule

**Signature parity:** notary signatures must verify inside the contract
circuit — the 22-field assertion encoding (`encodeAssertion`) is contract law.
Off-chain code never reimplements it; it imports the compiled
`pureCircuits.encodeAssertion`/`schnorrChallenge`. The roundtrip test
(`packages/contract/tests/parity-roundtrip.test.ts`) guards this forever.

# NOTARY.md — Notary Signer + client integration (notary/client agent's file)

You own `notary/` and the contract↔client glue. You convert **verified Reclaim proofs into Midnight-verifiable Jubjub-Schnorr signatures** (2-of-3 of you must be trusted). The single most important rule: **signature parity** (see `ARCHITECTURE.md` §4).

## 1. What you build

A TypeScript service, run as **3 independent instances** (3 distinct keys — for the demo, 3 processes on one machine with 3 `.env` files is acceptable; make key separation visible in the UI). Midnight-related wiring (contract interaction, provider stack) should mirror the reference app at `/home/batman/Documents/txpipe-shop/midnight-reference-app` (see `AGENTS.md` §4).

```
notary/
├── src/
│   ├── index.ts            # HTTP API: POST /attestate { proofArtifacts } → { assertion, signature }
│   ├── verify-reclaim.ts   # verify proof using @reclaimprotocol/attestor-core's SDK
│   ├── assert.ts           # build the typed assertion (CONTRACT.md §2 schema — EXACT encoding)
│   ├── sign.ts             # Jubjub-Schnorr signing (parity with contract)
│   └── config.ts           # env: NOTARY_KEY, PORT, CONTRACT_ADDRESS
├── tests/                  # vitest
└── .env.sample
```

Flow per instance: receive proof artifacts → **independently** verify with Reclaim's SDK → extract metric claims (from the verified response: `distance`, `moving_time`) → build `Assertion {version=1, provider=1, claims, claimCount, timestamp, nonce, reclaimProofHash}` → sign → return `{assertion, signature}`.

Each instance must verify independently (no shared verification cache) — the threshold only means something if the three don't trust each other.

## 2. Verification (verify-reclaim.ts)

- Use `@reclaimprotocol/attestor-core`'s own verification functions (the SDK used to produce the proofs is the SDK that verifies them). Confirm exact API surface from the attestation agent's artifact-schema doc and the package's exports.
- Also verify claim-level sanity: the claim covers the expected host (Strava), and the response contains the fields we parse (fail loudly otherwise).
- If the attestor's signature scheme differs from what you expected (build-start verification #1), adapt the parsing here — the contract does not care; your job is to verify the proof and extract the claims.

## 3. Signing & parity (sign.ts) — READ TWICE

- Sign the assertion with **Jubjub-Schnorr** matching the contract's `schnorr.compact`:
  1. Generate random nonce `k`; `R = G*k`.
  2. Challenge: **must be computed with the exact same hash input ordering as the contract**: `transientHash(ann_x, ann_y, pk_x, pk_y, msg)`.
  3. Truncate to 248 bits: `c = cFull % 2^248`.
  4. `s = k + c*sk (mod Jubjub order)`; signature = `(R, s)`.
- **Preferred:** import `pureCircuits.schnorrChallenge` from the contract's compiled output (the contract agent exports it). **Fallback:** reimplement via the Compact runtime's own serialization of the assertion struct — and then prove parity with the roundtrip test.
- The challenge input `msg` is the assertion **struct as the circuit encodes it** — field order, widths, and encoding must match `assertion.compact` exactly. Coordinate with the contract agent on Day 1; freeze the encoding before writing the signer.
- **Roundtrip test (mandatory, Day 1 PM):** sign with your signer → verify in the contract's simulator path → must pass. Flip one claim byte → must fail. Nothing downstream proceeds until this passes.

## 4. API surface (index.ts)

- `POST /attestate` — body: the proof artifacts (from `client/`); response: `{ assertion, signature, notaryId }`.
- `GET /health` — key id, instance id (for the demo's "3 notary keys" screen).
- `GET /pubkey` — the registered public key (the contract agent registers all three).
- Keep instances stateless; each instance exposes the same API with its own key.

## 5. Client glue (`client/`-adjacent, or here)

- Wire the zk-fetch client → call all 3 notaries → collect ≥2 signatures → package the contract transaction (submit to `verifyAttestation`).
- Also expose the flows used by the demo: attest → wager → settle; streak → badge → proveBadge. Keep these as callable functions the UI agent can invoke.

## 6. Tests

1. `verify-reclaim` accepts genuine fixture proofs, rejects tampered artifacts.
2. `assert` builds schema-valid assertions (parity with the contract agent's struct — shared fixture test).
3. `sign` → simulator roundtrip: accepted; tampered → rejected.
4. 2-of-3 aggregation: contract accepts any 2 of the 3 instances' signatures.

## 7. Definition of done

- 3 instances running with 3 keys; `/health` and `/pubkey` respond.
- A fixture proof → verified → asserted → signed → **accepted in the contract simulator** (roundtrip test green).
- Client glue produces the `verifyAttestation` transaction payload.

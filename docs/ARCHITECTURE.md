# ARCHITECTURE.md — WitnessFitness

Authoritative architecture, trust model, and the one rule that must never break: **signature parity**.

## 1. End-to-end data flow

```
 1. User (in client/ UI) authorizes Strava OAuth for a test athlete.
 2. client/ issues an HTTPS request through the zk-fetch flow:
    - TLS session runs between the user's client and Strava's API.
    - The self-hosted Attestor (Reclaim attestor-core) intermediates,
      producing: (redacted-request, redacted-response, zkproof) + a
      signed claim. The attestor can attest the interaction without
      seeing sensitive fields.
 3. The proof artifacts are sent to EACH of the 3 Notary Signers.
 4. Each Notary Signer:
    a. Verifies the Reclaim proof using @reclaimprotocol/attestor-core's
       own verification functions (same SDK that produced it).
    b. Extracts the metric claims (e.g. distance from a Strava activity).
    c. Builds a typed, versioned assertion (schema in CONTRACT.md §2).
    d. Signs the assertion with its own Jubjub-Schnorr key.
 5. The user's client submits (assertion, sig1, sig2, sig3) to the
    contract's verifyAttestation circuit.
 6. The circuit: registry membership → ≥2 valid Schnorr sigs → freshness
    + nullifier → predicates → stores a sealed credential bound to the
    holder secret.
 7. Wager/streak/badge entrypoints consume vaulted credentials.
```

## 2. Trust model (honest, by design)

- The contract cannot verify Reclaim's circom SNARKs, so it trusts registered keys — an **oracle-style trust anchor**. This mirrors TLSNotary's own guidance for on-chain use ("trust the notary / combine with an oracle protocol when stakes are high").
- **2-of-3 threshold:** three independently-operated Notary Signers; forging a claim requires two of three keys to collude. The contract checks signatures from the 3 registered public keys and requires ≥2 valid.
- **Privacy boundary:**
  - *On-chain:* notary public keys, commitments, timestamps, nullifiers, predicate results, sealed vault entries. Nothing personal.
  - *Off-chain (with the user):* the raw workout values, the Reclaim proof artifacts.
  - *Never exists anywhere:* plaintext assertions outside the user's machine and the notary signers' memory.
- **Integrity boundary:** the attestor witnesses a real TLS session with the real API; the notary signers re-verify the proof; the circuit verifies the signatures. A user cannot self-sign (their signature would be from an unregistered key).

## 3. Attestation layer details

- Reclaim attestor-core is self-hosted: set `PRIVATE_KEY`, run on port 8001, WebSocket endpoint `wss://localhost:8001/ws`.
- Optional but recommended: `createAuthRequest` with `hostWhitelist: ['www.strava.com']` so the attestor only tunnels whitelisted hosts.
- zk-fetch SDK (`@reclaimprotocol/zk-fetch@1.1.0`) is the client-side entry point ("fetch, but with a zkproof"). Point it at the local attestor URL.
- For Node usage, run `npm run download:zk-files` (in the workspace that installs the attestor packages) so ZK proof generation/verification works outside the browser.
- Full details and fallbacks: `ATTESTATION.md`.

## 4. Signature parity — the one rule that must never break

The notary signer's signatures must verify inside the circuit. The challenge hash is computed over a **struct encoding that must be byte-for-byte identical** on both sides.

Rules:
1. The contract's `schnorr.compact` challenge = `transientHash(ann_x, ann_y, pk_x, pk_y, msg)` where `msg` is the typed assertion encoded per the contract's struct.
2. The off-chain signer MUST use the identical encoding. Preferred: import `pureCircuits.schnorrChallenge` from the compiled contract output (zk-loan attestation-api pattern). Fallback: reimplement using the Compact runtime's own serialization, then prove parity with the roundtrip test.
3. **Roundtrip test (mandatory, before any E2E):** sign an assertion off-chain → call the contract's verification path in the simulator → assert acceptance. Repeat with a tampered byte → assert rejection. If this test doesn't pass, nothing downstream works.
4. Truncate the challenge to 248 bits exactly as the contract does (`c = cFull % 2^248`).

## 5. Credential vault & holder binding

- `verifyAttestation` stores `commitment = persistentCommit(assertion, rand)` in the ledger, plus `timestamp`, `nullifier`.
- The credential is bound to the holder via `hashToCurve(holderSecret)`: only someone knowing the holder secret can later *spend* the credential (enter a wager, advance a streak, mint a badge).
- Nullifiers are scoped: a credential can be used across challenges, but the same workout cannot be double-counted in the same challenge (nullifier = hash(credential, challengeId)).
- Fields not disclosed stay private witness data — the circuit proves predicates, never values.

## 5b. Points treasury (Phase A v3 — no unshielded tokens)

Wagers are **internal points** (`balances` Map keyed by holder binding);
NIGHT enters/leaves only through shielded on/off-ramps:

- `depositPoints` receives the caller's shielded NIGHT coin and passes it
  straight through to the admin `treasuryKey` in the SAME transaction
  (`sendImmediateShielded` — the contract never holds value across txs, so
  the committed-coin path (`sendShielded` + `mt_index` from the indexer)
  never appears). The caller's points are credited; the payout key is
  registered.
- `withdrawPoints` is **admin-initiated**: the admin wallet offers a
  treasury coin, the contract debits the user's points and routes the NIGHT
  to the user's registered payout key (pinned — the admin can stall, never
  redirect). Largest-coin selection + change-back keeps the admin wallet
  free of exact-value coin management.
- Platform fee: 2% of stake at create/accept, credited to the admin binding
  — a pure balance credit, invisible on-chain.

Privacy ledger (honest): deposits/withdrawals hide amounts and wallet
linkage (Zswap); the wager record (stake, pseudonymous bindings, sealed
submissions) stays public as before; `balances` values are public per
pseudonym (hidden balances are the ShieldedERC20 tier — archived by
OpenZeppelin as "DO NOT USE IN PRODUCTION"; internal accounts keep the
contract as the spend-enforcement authority instead).

**Scale-up path (documented, not built):** the admin-initiated withdrawal
is a custodial workaround pending contract-held-value tooling maturity.
`txpipe-shop/midnight-reference-app#49` ("Improved contract design",
draft) is the known-good route: a sponsor-service operator with indexer
integration + `protocol-verification` experiments (multi-call txs,
guaranteed/fallible partitioning, tx-merge) enabling user-initiated
withdrawals (user builds the call tx; the admin's coin-offer tx merges in)
and, further out, a trustless contract-held treasury.

## 6. Mechanical specifics (all decided)

| Item | Decision |
|---|---|
| Chains | Midnight only. No effectstream, no cross-chain (growth slide only) |
| Contract count | 1 (no cross-contract calls on Midnight yet) |
| Notary threshold | 3 registered keys, ≥2 signatures required |
| Signature scheme | Jubjub-Schnorr (stdlib `jubjubSchnorrVerify` if available in compact 0.4.0, else zk-loan polyfill) |
| Assertion hashing | `transientHash` (Poseidon) for challenges; `persistentCommit` (SHA-256) for on-chain storage |
| Stakes | Internal points (`balances` per holder binding); shielded NIGHT on/off-ramp via deposit/withdraw (treasury passthrough) |
| Deadline | `blockTimeGte` + grace window for forfeit |
| Demo data source | Real Strava API via OAuth; fixture proofs as fallback |

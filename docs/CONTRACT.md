# CONTRACT.md — Midnight Compact contract (contract agent's file)

You own everything under `contract/`. Midnight/Compact knowledge is assumed. This file pins the project-specific schema and semantics — deviations require sign-off.

## 1. Files

```
packages/contract/
├── src/
│   ├── schnorr.compact      # Jubjub Schnorr verification
│   ├── assertion.compact    # assertion schema + challenge hash
│   ├── stride.compact       # main contract
│   └── witnesses.ts         # private witness implementations (TS)
├── tests/                   # vitest + compact simulator
└── package.json
```

**Pattern source:** mirror the reference app at `/home/batman/Documents/txpipe-shop/midnight-reference-app` — copy its dependency versions (`VERSIONS.md`), its `providers.ts` provider stack, and its witness conventions. The contract wrapper class lives in `packages/api` (mirroring `SentinelContract`), not here.

**schnorr.compact:** copy the known-good zk-loan tutorial module verbatim first. Then check whether compact 0.4.0's stdlib ships `jubjubSchnorrVerify`; if it exists and passes the same tests, prefer it. Either way the interface consumed by `stride.compact` stays: `schnorrVerify(msg: Vector<n, Field>, signature, pk)`.

## 2. Assertion schema (versioned, typed — the common interface)

```compact
struct Claim {
    metricId: Uint8;      // e.g. 1 = distance (meters), 2 = moving time (sec)
    value: Uint64;        // keep fixed-width, small
}

struct Assertion {
    version: Uint8;           // 1
    provider: Uint8;          // 1 = reclaim-attestor
    claims: Vector<8, Claim>; // fixed capacity, actual count carried in a field
    claimCount: Uint8;
    timestamp: Uint32;        // Unix seconds of the API interaction
    nonce: Bytes<32>;         // per-assertion randomness (replay protection)
    reclaimProofHash: Bytes<32>; // hash of the Reclaim proof artifacts (binding)
}
```

- The **exact field order is contract law** — the challenge hash (and thus every signature) depends on it. Freeze this struct on Day 1 and tell the notary agent the final encoding (or better: share the compiled `pureCircuits`).
- Keep the struct small: SHA-256 (`persistentCommit`) inside the circuit is the expensive op; `claims` capacity 8 is generous.

## 3. Ledger state

```compact
ledger {
    registry:       Vector<JubjubPoint, 3>;   // notary public keys
    adminSecret:    Field;                    // witness-secret identity (zk-loan pattern)
    vault:          Map<Bytes<32>, VaultEntry>;   // commitment → entry
    nullifiers:     Set<Bytes<32>>;           // global replay protection
    wagers:         Map<Uint, Wager>;
    nextWagerId:    Uint;
    streaks:        Map<Field, Streak>;       // keyed by holder binding
    badges:         Map<Field, Set<Uint8>>;
    balances:       Map<Field, Uint>;         // contract-escrowed demo stakes
}
```

```compact
VaultEntry { holderBinding: Field; timestamp: Uint32; }
Wager {
    challenger: Field; opponent: Field;      // holder bindings
    metricId: Uint8; stake: Uint; deadlineBlock: Uint;
    challengerSubmission: Maybe<Bytes32>;    // persistentCommit(value, rand)
    opponentSubmission: Maybe<Bytes32>;
    settled: bool;
}
Streak { count: Uint16; lastDay: Uint32; }   // day = timestamp / 86400
```

## 4. Entrypoints (semantics)

1. **`registerAdmin()`** — the admin identity is pinned by the **constructor at deploy** (audit M1: no first-call race — a front-runner can no longer seize admin between deploy and registration); the circuit re-asserts the caller holds the admin secret (zk-loan pattern), never an address.
2. **`registerNotary(pk, index)` / `rotateNotary(index, newPk)` / `blacklistNotary(index)`** — admin only. Registry is exactly 3 slots; slots may be empty (empty slot = signature must be invalid → treat as not counted).
3. **`verifyAttestation(...)`** — private witness: full `Assertion` fields, 3 signatures, holder secret, commit randomness.
   - Circuit: (a) for each registered key, verify signature over the assertion; count valid; **require ≥2**. (b) `timestamp` within a freshness window vs current block time — **set to ≥30 days for the demo build** (fixture proofs generated before demo day must still pass; regenerate fixtures the morning of the demo regardless). (c) `nonce` not in nullifiers; insert it. (d) compute `holderBinding = hashToCurve(holderSecret)`. (e) store `vault[persistentCommit(assertion, rand)] = {holderBinding, timestamp}`.
   - Ledger learns: commitment, timestamp, nullifier. Not the assertion, not the values.
4. **`createWager(opponentBinding, metricId, stake, deadlineBlock)`** — **deadline gates (audit H1):** the deadline must be in the future (`blockTimeLt(deadline)`), the opponent cannot be yourself, and the stake is capped at 2⁶³−1 so the settle payout (`2 × stake`) always fits `Uint64`. Escrow both sides (opponent must accept via `acceptWager` before the deadline, else the challenger can `cancelWager` for a refund). Creates `wagers[nextWagerId]`.
5. **`acceptWager(id)`** — escrow opponent's stake; **only while `blockTimeLt(deadline)`** — a closed wager cannot be accepted (the opponent cannot be trapped into an instant forfeit).
6. **`submitWorkout(wagerId, vaultKey, value, revealRand)`** — (a) proves `vault[vaultKey].holderBinding == caller` (knowledge of holder secret), (b) proves `persistentCommit(assertion, revealRand) == vaultKey` with `claims[metricId] == value`, (c) scoped nullifier `hash(vaultKey, wagerId)` — one use per (credential, challenge), (d) stores the sealed value `persistentCommit(value, submissionRand)` as `Bytes32`; **only while `blockTimeLt(deadline)`** — submissions close at the deadline.
   - Values stay **sealed** — the ledger stores only commitments, never the number.
7. **`settleWager(id)`** — require `blockTimeGte(deadlineBlock + grace)`; if both submitted: compare committed values (circuit opens both under commitments), winner receives both stakes; ties refund both. If one side never submitted: the other wins by forfeit; if neither: refunds.
   - **Disclosure note (audit L3):** settlement necessarily publishes both opening values on-chain (the payout branch is public) — the guarantee is *sealed until settlement*, not *never revealed*.
8. **`advanceStreak(vaultKey, day, revealRand)`** — holder-bound credential with `timestamp` in `day`; require `day == lastDay + 1` (else reset to 1); update `streaks[holder]`.
9. **`mintBadge(badgeId, ...)`** — predicates over vaulted credentials (e.g. streak ≥ 30) or feat thresholds; store `badges[holder] += badgeId`. Badge data stays sealed.
10. **`proveBadge(badgeId, verifierBinding)`** — proves (a) holder owns the badge, (b) holder binding matches caller, (c) optional: predicate over the underlying credential — **without revealing streak counts or dates**. This is the "prove it to an employer" moment.

## 5. Costs & pitfalls

- Challenge hash: `transientHash` over the assertion (Poseidon — cheap). Storage: one `persistentCommit` per attestation (SHA-256 — keep structs small).
- 2-of-3 Schnorr = ~3 verifies, linear. Fine.
- `Uint64` values: if the simulator/runtime limits widths, prefer `Uint32` for values and document the max (distances fit easily in meters).
- No cross-contract calls — everything in one contract.

## 6. Witnesses.ts

- Feed assertion fields as private witness inputs.
- Implement the off-chain assertion builder + signature packaging *here* or in the notary workspace? → Assertion *building/signing* lives in `notary/`; `witnesses.ts` only adapts inputs for the circuit. Export the compiled `pureCircuits` (schnorrChallenge) as the single source of truth for the notary agent's signing parity.
- Hold your `hashToCurve`/`persistentCommit`/`transientHash` calls identical to the contract's builtins — use the Compact runtime functions, not hand-rolled hashing.

## 7. Tests (vitest + compact simulator — mandatory list)

1. `verifyAttestation` accepts 2-of-3 and 3-of-3 valid signatures.
2. Rejects 1-of-3.
3. Rejects tampered assertion (flip a claim value) — signature invalid.
4. Rejects replay (same nonce twice).
5. Rejects stale timestamp (older than the window).
6. `createWager`/`acceptWager`: escrow math, refund on non-acceptance.
7. `submitWorkout` double-count blocked per (credential, challenge); same credential allowed in *different* challenges.
8. `settleWager`: both-submit (winner + tie), forfeit, deadline enforcement (can't settle early).
9. `advanceStreak`: advance, reset on gap, boundary day handling.
10. `mintBadge` + `proveBadge`: verification succeeds without revealing values; proveBadge fails for a non-holder.
11. **Signature parity roundtrip** (from `ARCHITECTURE.md` §4): off-chain-signed assertion accepted; tampered rejected.

## 8. Definition of done (contract)

All tests above green on the simulator; contract deploys on the local devnet; `pureCircuits` exported for the notary agent; ABI/entrypoint list documented in the workspace README for the UI agent.

# PITCH.md — WitnessFitness pitch outline (6 slides)

Deck format: markdown → slides. The hook slide embeds the rehearsal GIF of the
sealed-wager reveal. One line per slide is the spoken beat; the rest is speaker
notes.

---

## 1. Hook — "the chain compared two workouts it can't see"

- Video: settle reveal — two sealed envelopes flip, pot moves, room gasps,
  "find the losing number", nobody can.
- Spoken line: *"That was a real wager, settled on a real chain. Nobody in
  this room — including the chain — saw a single number."*

## 2. Problem — fitness-economy apps died of bots; health data can't be shared

- STEPN / Sweatcoin: step-count games died because fake proofs were free.
- Strava shows everything: where you run, when, how fast — a surveillance
  profile for a monthly leaderboard.
- The two hard requirements are in tension: **provable** (anti-bot) and
  **private** (health data). Existing systems pick one.

## 3. Solution — WitnessFitness

- **Attested workouts** (anti-bot): real TLS session with Strava witnessed by
  a self-hosted Reclaim attestor — no fake-proof path.
- **Private by default** (ZK): the chain stores commitments; it never sees a
  workout. It can prove "distance ≥ 5 km" without knowing it's 12.4.
- **Fun** (engagement): wagers, streaks, badges — the consumer flywheel.
- Tagline: *"prove the workout, hide the data."*

## 4. Architecture — one honest slide

```
Strava API ──TLS──▶ attestor-core (Reclaim, self-hosted)
                        │ signed claim + ZK proof
                        ▼
              Notary Signers ×3 (independent keys)
                        │ ≥2 Jubjub-Schnorr signatures
                        ▼
         Midnight contract: verifies Schnorr + freshness + nullifiers
              → vault (commitments) → wager/streak/badge mechanics
```

- Trust model stated plainly: Midnight can't verify Reclaim's SNARKs, so the
  contract trusts registered keys — an oracle-style anchor; 2-of-3 collusion
  threshold mitigates it. (Same guidance TLSNotary gives for on-chain use.)
- One chain, one contract, no bridges.

**Speaker notes — how it uses Midnight (feature map):**

- **ZK-native transitions:** every action is a Compact circuit — `verifyAttestation`,
  `submitWorkout`, `settleWager`, `advanceStreak`, `mintBadge`, `proveBadge`. Each
  proves a predicate over sealed data (signature validity, freshness, claim ≥
  threshold, streak continuity) without ever revealing the underlying values.
  "The chain doesn't store your workout; it stores the fact that the predicate
  held."
- **`disclose()` privacy model:** witness values are private by default; *every*
  on-chain byte must pass through an explicit `disclose()` call (holder binding,
  wager id, commitments, predicate results). The privacy boundary is enforced by
  the compiler's disclosure rules — not by convention. A circuit author cannot
  accidentally leak a witness value.
- **Native crypto in-circuit:** Jubjub-Schnorr verification happens inside the
  circuit (2-of-3 notary signatures — the parity gate is regression-tested
  end-to-end); holder binding uses `hashToCurve(holderSecret)` — the chain stores
  a curve point, **no wallet addresses at all**; the vault uses `persistentCommit`
  (SHA-256, stored); challenge hashes use `transientHash` (Poseidon, cheap in
  circuit). The whole trust pipeline is verifiable on-chain, not off-chain.
- **Nullifier pattern:** every attestation and every wager submission burns a
  scoped nullifier — replaying the same proof is impossible (fixture replay
  protection is a feature, not a bug: one proof = one attestation). Nullifiers
  are scoped per challenge so a credential can be used across challenges without
  double-counting in the same one.
- **In-circuit chain time:** `blockTimeGte`/`blockTimeLt` give the contract a
  native clock — freshness windows (30-day attestation validity), wager
  deadlines + grace, and streak day boundaries all settle deterministically in
  the circuit. No oracles for time.
- **One contract, both languages (the hybrid pot):** wagers escrow **real
  unshielded NIGHT** — participants' wallets spend NIGHT UTXOs into the
  contract, settle pays the winner's unshielded address via the kernel (pot
  drama is public — that's the point). The winner also receives a **shielded
  NFT** (`kernel.mintShieldedToken`) — a coin in the shield tree they can prove
  they own without revealing. Public money, sealed workouts, private
  souvenir: the same circuit speaks both domains. (Live-proven end-to-end:
  settle tx `fe0ca996…`, pot 20 NIGHT, NFT tokenType `91f59aa0…`.)
- **Deferred (say it if asked):** badge sets are flat structures today —
  MerkleTree membership for large verifier groups later; a fully shielded pot
  (even the money in the shield tree) is the production-grade evolution of the
  hybrid — "today the pot is public, tomorrow even the money is sealed."

## 5. Business — B2B2C: the employer pays, the consumer plays

- **Employer wellness programs** pay per-employee for verifiable participation
  — the platform *never sees health data*, which removes the employer's
  liability (HIPAA/GDPR-shaped) and the employee's privacy objection.
- Consumer mechanics (wagers, streaks, badges) are the engagement flywheel
  that keeps the attestation pipeline fed.
- **Moat story:** attestation backends are pluggable — Reclaim today,
  TEEs / MPC-TLS (e.g. TLSNotary) later; the credential vault and contract
  stay the same. The registry is the moat, not the TLS client.

## 6. Roadmap

- Now: fixture → local devnet demo (this build).
- Next: public testnet, real Strava fixtures, 2-wallet wager E2E.
- Then: multi-vertical reuse of the same vault — rent (proof of income),
  insurance (proof of activity), payroll (proof of attendance). One attested
  credential, many predicates, zero data leakage.

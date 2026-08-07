# GLOSSARY.md — plain-English crypto for the demo team

All pointers verified against the repo. When in doubt, `ARCHITECTURE.md` §4 wins.

- **Attestor** — the witness server (Reclaim `attestor-core`, self-hosted, port 8001) that sits inside the TLS session with Strava and produces a ZK proof + signed claim that the API call really happened.
  *Code:* `attestor/run.sh`, `packages/client/fixtures/artifact-schema.md` §1.
- **zk-fetch** — "fetch, but with a zkproof": the client-side SDK that makes the Strava request through our attestor and returns the proof artifact.
  *Code:* `packages/client/src/attest.ts` (`attestRequest`), `artifact-schema.md` §2.
- **Claim / ProviderClaimData** — the attestor's signed statement: which URL was fetched, when, by whom (`parameters`, `timestampS`, `owner`, `identifier`, `context`). Contains no secrets — the auth token lives only in the encrypted TLS transcript.
  *Code:* `artifact-schema.md` §3–4.
- **EIP-191 signature** — the attestor's scheme: Ethereum-style ECDSA over a personal-sign digest, 65 bytes `r‖s‖v`, signer identified by an ETH address. The notary checks it with Reclaim's own SDK.
  *Code:* `artifact-schema.md` §1, `packages/notary/src/verify-reclaim.ts`.
- **Jubjub-Schnorr signature** — the notaries' "unforgeable stamp": an ECDSA-like signature the *contract* verifies natively. The stamp is `(announcement, response)` — like a wax seal: anyone can check it, no one can forge it.
  *Code:* `schnorr.compact:11` (`SchnorrSignature`), `packages/notary/src/sign.ts` (`signAssertion`).
- **Challenge + 248-bit truncation** — the signed message hash. The hash output is larger than Jubjub's scalar field, so the circuit splits it `c = q·2^248 + r` (a witness proves the split) and signs with `r`. Truncation is mandatory: an untruncated challenge does not verify.
  *Code:* `schnorr.compact:43` (`truncateChallenge`), `offchain.ts:57–58`.
- **transientHash (Poseidon)** — cheap hash for the Schnorr challenge (snark-friendly; don't trust its output to third parties).
  *Code:* `assertion.compact:61` (`schnorrChallenge`).
- **persistentCommit (SHA-256)** — strong hash for the vault key, unforgeable even by the contract's own operator.
  *Code:* `stride.compact:217`, pure `computeVaultKey` `stride.compact:443`.
- **hashToCurve + holder binding** — "pseudonym from a secret": the holder secret maps to a curve point; its x-coordinate is the on-chain binding. Only the secret-holder can compute it, so only they can spend their credentials.
  *Code:* `stride.compact:56` (`deriveHolderBinding`), pure `holderBinding` `stride.compact:447`.
- **Commitment (sealed envelope)** — a value + random salt, hashed: reveals nothing, locks the value in. Vault keys are persistent envelopes; wager submissions use `transientCommit`.
  *Code:* `stride.compact:217`, `stride.compact:314`.
- **Nullifier (one-use ticket)** — a hash derived from a credential; once on-chain, the credential can't be reused for that purpose.
  *Code:* nonce nullifier `stride.compact:212–216`; per-wager `stride.compact:307–313`.
- **2-of-3 threshold + registry** — the contract stores 3 notary public keys; `verifyAttestation` *counts* valid signatures (`schnorrVerifyOk`, non-aborting) and requires ≥2. Forging a claim needs two colluding keys.
  *Code:* ledger `stride.compact:34`, `countValidSignatures` `stride.compact:95`, check `stride.compact:206`.
- **Vault** — ledger `Map<Bytes<32>, VaultEntry>`: key = commitment, entry = holder binding + timestamp. Nothing about the workout is stored.
  *Code:* `stride.compact:36`, `VaultEntry` `stride.compact:12`.
- **Freshness window** — how old an attestation may be: 30 days (demo decision), enforced in-circuit against the claim timestamp.
  *Code:* `freshnessWindow()` `stride.compact:65`, checks `stride.compact:208–211`.
- **Signature parity (THE rule)** — off-chain signing must match the circuit byte-for-byte: frozen 22-field encoding, Poseidon challenge, 248-bit truncation, same modulus. Break it and every signature is rejected in-circuit.
  *Code:* `packages/contract/src/offchain.ts` (parity reference), `packages/contract/README.md` "Notary parity contract", `ARCHITECTURE.md` §4.
- **Fixture (replayed proof)** — a saved proof artifact replayed through the exact same verification path when a live attestation isn't available. Same crypto, no live session.
  *Code:* `packages/client/fixtures/`, `artifact-schema.md` §5.
- **Simulator vs devnet** — the simulator is in-memory contract testing (Vitest, fast, no network); the devnet is the real local stack in Docker (node + indexer + proof server). Tests run on the simulator; E2E runs on the devnet.
  *Code:* `packages/contract/tests/`, `devnet/compose.yml`.
- **Nonce** — 32 bytes inside the assertion that make each claim unique; all three notaries derive the same one from the artifacts so they sign identically; the contract nullifies it on first use.
  *Code:* `assertion.compact:21`, `packages/notary/src/assert.ts:83`.

# @witnessfitness/contract

WitnessFitness Midnight contract package: notary registry, `verifyAttestation`,
credential vault, and wager / streak / badge mechanics over sealed, attested
fitness data. All contract logic lives in one Compact contract
(`src/stride.compact`); this package also exports the **signature-parity
surface** that the notary signer MUST use for off-chain signing.

Status: simulator suite green (33/33), signature-parity gate GREEN
(`tests/parity-roundtrip.test.ts`).

## Sources

| File | Purpose |
|---|---|
| `src/assertion.compact` | Versioned assertion schema + frozen field encoding (CONTRACT.md §2) |
| `src/schnorr.compact` | Jubjub-Schnorr verify (zk-loan polyfill; stdlib `jubjubSchnorrVerify` does not exist in compact 0.31.1) |
| `src/stride.compact` | Main contract: all entrypoints + ledger |
| `src/offchain.ts` | Off-chain signing reference (parity contract for the notary) |
| `src/witnesses.ts` | Private witness implementations (TS) |
| `src/index.ts` | Package surface: `CompactCompiledContract` + re-exports of `pureCircuits` and signing helpers |
| `src/managed/stride/` | Compiled contract output (JS + `.d.ts` + PLONK `keys/`) — do not hand-edit |
| `tests/` | Vitest + simulator suites (`parity-roundtrip`, `stride`) |

## Assertion encoding freeze — contract law

The `Assertion` struct field order and the `encodeAssertion` layout are
**frozen** (CONTRACT.md §2). The challenge hash commits to
`encodeAssertion(assertion)` as `Vector<22, Field>` in this exact order:

```
[0]  version            [11] claims[5].value
[1]  provider           [12] claims[6].metricId
[2]  claims[0].metricId [13] claims[6].value
[3]  claims[0].value    [14] claims[7].metricId
[4]  claims[1].metricId [15] claims[7].value
[5]  claims[1].value    [16] claimCount
[6]  claims[2].metricId [17] timestamp
[7]  claims[2].value    [18] nonce (as Field, degradeToTransient)
[8]  claims[3].metricId [19] reclaimProofHash (as Field, degradeToTransient)
[9]  claims[3].value
[10] claims[4].metricId
```

Any change to this ordering invalidates every signature. Never reimplement it
off-chain — import `encodeAssertion` (below).

## Entrypoints (ABI)

Compiled types: `Circuits` / `ImpureCircuits` in
`src/managed/stride/contract/index.d.ts`. All ledger values are `bigint` /
`Uint8Array` / plain objects.

| Circuit | Args (JS types) | Returns | Notes |
|---|---|---|---|
| `registerAdmin()` | — | `[]` | Constructor pins the admin identity at deploy (witness secret); the circuit re-asserts the caller is admin |
| `registerNotary(pk, index)` | `pk: JubjubPoint`, `index: bigint` (0–2) | `[]` | Admin only; 3 fixed slots |
| `rotateNotary(index, newPk)` | `index: bigint`, `newPk: JubjubPoint` | `[]` | Admin only |
| `blacklistNotary(index)` | `index: bigint` | `[]` | Admin only; empties slot (signatures there no longer count) |
| `deposit(amount)` | `amount: bigint` | `[]` | Demo escrow; credits caller's own holder binding |
| `verifyAttestation()` | — (witness: assertion, 3 sigs, commit rand, holder secret) | `[]` | Requires ≥2 valid registered signatures, freshness window (30 days), nonce not replayed, stores `vault[persistentCommit(assertion, rand)]` bound to holder |
| `createWager(opponentBinding, metricId, stake, deadlineBlock)` | `opponentBinding: bigint`, `metricId: bigint` (1=distance m, 2=moving time s), `stake: bigint`, `deadlineBlock: bigint` | `[]` | Escrows caller's stake |
| `acceptWager(id)` | `id: bigint` | `[]` | Escrows opponent's stake; only by the named opponent |
| `cancelWager(id)` | `id: bigint` | `[]` | Challenger refund before acceptance |
| `submitWorkout(wagerId, vaultKey, value)` | `wagerId: bigint`, `vaultKey: Uint8Array` (32), `value: bigint` | `[]` | Sealed submission; scoped nullifier per (credential, wager) |
| `settleWager(id)` | `id: bigint` | `[]` | After `deadlineBlock + 60s`; winner takes both stakes, tie refunds both, forfeit if one side, refund if neither |
| `advanceStreak(vaultKey, day, commitRand)` | `vaultKey: Uint8Array`, `day: bigint` (timestamp/86400), `commitRand: Uint8Array` | `[]` | Advances or resets streak; credential must fall in `day` |
| `mintBadge(badgeId, vaultKey, commitRand)` | `badgeId: bigint` (1=streak≥3, 2=distance≥10000 m), `vaultKey: Uint8Array`, `commitRand: Uint8Array` | `[]` | |
| `proveBadge(badgeId, verifierBinding)` | `badgeId: bigint`, `verifierBinding: bigint` | `[bigint]` | Returns `verifierBinding`; holder binding stays private |

Pure circuits (callable with `pureCircuits.*` or from the wrapper):
`encodeAssertion`, `schnorrChallenge`, `computeVaultKey`, `holderBinding`.

## Notary parity contract (signing must match the circuit)

Import from `@witnessfitness/contract` (re-exported by `src/index.ts`):

```ts
import {
  JUBJUB_ORDER,
  derivePublicKey,
  deriveNonce,
  encodeAssertion,    // pureCircuits.encodeAssertion
  schnorrChallenge,   // pureCircuits.schnorrChallenge
  signAssertion,
} from '@witnessfitness/contract';
```

Signing algorithm (identical to `src/offchain.ts` — the parity reference):

1. `msg = encodeAssertion(assertion)` — the frozen 22-field encoding; never
   hand-roll it.
2. `pk = derivePublicKey(sk)` — `ecMulGenerator(sk)`.
3. `k = deriveNonce(sk, nonceSeed)` (deterministic fixture helper) or a CSPRNG
   scalar in `[1, JUBJUB_ORDER-1]` in production.
4. `announcement = ecMulGenerator(k)`.
5. `cFull = schnorrChallenge(announcement, pk, msg)` — Poseidon
   (`transientHash`) over `(ann_x, ann_y, pk_x, pk_y, msg)`.
6. **Truncate: `c = cFull mod 2^248`** — `TWO_248 = 1n << 248n`. The circuit's
   witness splits `cFull = q * 2^248 + r` and asserts it; a signature built
   with the untruncated challenge does NOT verify.
7. `s = (k + c * sk) mod JUBJUB_ORDER` with
   `JUBJUB_ORDER = 0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n`.
8. Submit `{ announcement: { x, y }, response: s }` as the `SchnorrSignature`.

`signAssertion(sk, assertion, nonceSeed)` packages steps 1–7; the notary may
call it directly or reimplement steps with the exported primitives. Proven by
`tests/parity-roundtrip.test.ts`: off-chain-signed assertions are accepted
in-circuit (2-of-3 and 3-of-3); tampered assertions and unregistered keys are
rejected.

## UI-facing surface (for packages/api wrapper + ui/)

- Entrypoint names/signatures: table above (JS types from the compiled
  `Circuits` type).
- Witness-fed data must be placed in the private state
  (`createPrivateState(adminSecretKey, holderSecret)` from
  `src/private-state.ts`, then `assertion`/`signatures`/`commitRand`/
  `submissionRand`/`wagerOpenings` fields) — the wrapper pattern mirrors
  `SentinelContract` in the reference app (`packages/api` owns it).
- Ledger view (via `ledger(state)` or the indexer): `registry`, `vault`,
  `nullifiers`, `wagers`, `nextWagerId`, `streaks`, `badges`, `balances`.
- Helper pure circuits for the UI: `holderBinding(secret)` (compute a binding
  to show in a wager screen) and `computeVaultKey(assertion, rand)`.

## Wager interface (v2) — FROZEN (real-token pot + winner NFT)

The simulated `balances` map and `deposit` circuit are **deleted**. Wager pots
are real unshielded NIGHT: create/accept escrow via `receiveUnshielded`
(wallets spend NIGHT UTXOs into the contract), settle pays via
`sendUnshielded` to the winner's unshielded address, and the winner gets a
shielded NFT (`mintShieldedToken`, type `tokenType(pad(32,"witnessfitness:nft:v1"), contract)`).

**Circuit signatures (contract law):**

```ts
createWager(opponentBinding: bigint, metricId: bigint, stake: bigint,
            deadlineBlock: bigint, payout: Uint8Array /*32*/,
            coinKey: { bytes: Uint8Array } /*32*/): []
acceptWager(id: bigint, payout: Uint8Array /*32*/, coinKey: { bytes: Uint8Array }): []
cancelWager(id: bigint): []                                   // refunds challenger stake
submitWorkout(wagerId: bigint, vaultKey: Uint8Array, value: bigint): []
settleWager(id: bigint): []   // NO payout args — pays the stored routing only
```

- `payout` = the 32-byte `UserAddress` payload (`encodeUserAddress` of the
  address hex string; wallet bech32m → `UnshieldedAddress.codec.decode(...).hexString`
  first). Stored on the wager at create/accept; settle pays ONLY stored values.
- `coinKey` = the winner's shielded coin public key (NFT recipient).
- Escrow: the contract records `receiveUnshielded(nativeToken(), stake)` — the
  wallet must fund the corresponding unshielded output (transaction
  well-formedness enforces it; there is no in-circuit balance check — the
  simulator probe proved `unshieldedBalance` reads are construction-time and
  the VM enforces sufficiency at apply time).
- Settle: both-submit → winner gets `2*stake` + NFT, tie refunds both (no
  NFT); forfeit → single submitter gets `2*stake` + NFT; neither → refunds.

**Api flow signatures (packages/api, frozen for the sidecar agent):**

```ts
createWagerFlow(ctx, { opponentBinding, metricId, stake, deadlineBlock,
                       payout: Uint8Array, coinKey: { bytes } })
acceptWagerFlow(ctx, id, { payout, coinKey })
settleWagerFlow(ctx, id)          // returns the callTx result
userAddressBytes(addressHex: string): Uint8Array   // helper (encodeUserAddress)
```

The winner NFT mint is observable in tx effects (`shieldedMints`, value 1).
Simulator tests assert escrow/payout/NFT via effects
(`StrideSim.unshieldedInputSum/unshieldedOutputSum/shieldedMints`).

## Admin secret

- **Location:** `packages/contract/admin-secret.local` — plain hex string, one
  line, mode 0600. Gitignored (`.gitignore` has `admin-secret.local`); the
  `.env*` patterns do NOT cover it.
- **Written by:** `scripts/deploy.ts` (from `WF_ADMIN_SECRET` env or the demo
  default `00…a1`). **Read by:** `scripts/rotate-notaries.ts` and
  `packages/api/scripts/e2e-attest.ts` (via `../../contract/admin-secret.local`).
- **Never in deploy-output.json** — that file IS committed (contains only the
  contract address and demo notary public keys).
- The admin secret pins the contract's admin identity (witness-derived via
  `deriveAdminBinding`); losing it means the admin circuits
  (`registerNotary`/`rotateNotary`/`blacklistNotary`) are locked forever —
  the registry can only be re-set by deploying a fresh contract.

## Test / build

```bash
pnpm test            # compact:no-zk (--skip-zk) + vitest run — fast loop
pnpm compact         # full compile with PLONK key generation (slow; keys
                     # already present in src/managed/stride/keys/)
pnpm build           # full compile + tsc + copy managed output to dist
pnpm run deploy      # build + scripts/deploy.ts (devnet must be up; ~2–3 min)
                     # NOTE: `pnpm deploy` is a pnpm builtin — use `run deploy`
                     # writes deploy-output.json (contract address + demo
                     # notary public keys/seeds) and admin-secret.local (gitignored)
```

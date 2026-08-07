# STATUS.md — WitnessFitness workstream coordination

Every agent updates its section after **every session**: progress, blockers,
artifacts, next session goal. Orchestrator gates the dependents on the
**Hard gates** section. No commits without an explicit ask.

## Contract workstream (docs/CONTRACT.md)

- Status: **Phase A COMPLETE (session 5, 2026-08-07) — real unshielded NIGHT wager pot + shielded winner NFT; simulated balances/deposit DELETED; suite 120+1 green; redeployed 364a84dd…**
- Progress (session 5, 2026-08-07 — real-token wagers):
  - **CONTRACT (stride.compact)**: Wager struct v2 adds `challengerPayout`/`opponentPayout: Bytes<32>` (UserAddress payloads — NOT Bytes<96>; evidence: kernel sendUnshielded needs a UserAddress struct, 32 bytes; bech32m 96-byte strings cannot be decoded in-circuit; probe-compiled .d.ts + encodeUserAddress roundtrip verified) + `challengerCoinKey`/`opponentCoinKey: ZswapCoinPublicKey`. `balances` ledger map, `deposit` circuit, `payWinner`/`refundBoth` helpers DELETED. createWager/acceptWager escrow via `receiveUnshielded(nativeToken(), stake)` (real NIGHT: the wallet must fund the unshielded output — tx well-formedness enforces it; probe proved `unshieldedBalance` reads are construction-time, so NO in-circuit balance asserts — VM enforces at apply). cancelWager refunds via `sendUnshielded` to the pinned challenger payout. settleWager pays STORED routing only (no payout args — tamper impossible by construction): winner gets 2×stake + NFT, tie/none refund both, forfeit pays single submitter. Winner NFT: `mintShieldedToken(tokenType(pad(32,"witnessfitness:nft:v1"), kernel.self()), 1, evolveNonce(nftCounter, nftNonce), left(winnerCoinKey))` — tbtc-pattern nonce management (Counter + evolving nonce ledger).
  - **API (frozen v2 interface, README "Wager interface (v2)" section)**: `createWager(opponentBinding, metricId, stake, deadlineBlock, payout: Uint8Array, coinKey: {bytes})`, `acceptWager(id, payout, coinKey)`, `settleWager(id)`; flows `createWagerFlow(ctx, {…, payout, coinKey})` / `acceptWagerFlow(ctx, id, {payout, coinKey})` / `settleWagerFlow(ctx, id)`; helper `userAddressBytes(hexAddress)` (encodeUserAddress; wallet bech32m → UnshieldedAddress.codec.decode().hexString first). `deposit` method removed.
  - **TESTS**: wager suite reworked to effects-based verification (sim helper now exposes `unshieldedInputSum`/`unshieldedOutputSum`/`shieldedMints` from tx effects — the simulator does NOT carry unshielded balance across calls, probe-verified). New coverage: escrow-as-receive at create+accept, cancel refunds, stranger/re-accept rejection, payout/coin-key pinning (tamper-at-settle impossible), winner 2×stake + NFT mint, tie refunds no-NFT, forfeit pays single submitter + NFT, neither refunds, deadline, wrong openings, double-settle, distinct NFTs across wagers. Contract suite 40/40 (35 prior + net new).
  - **DEPLOY + ROTATE**: full build (13 circuits — deposit gone — keys regenerated), redeployed **`364a84dd0bc065d7ea25fd45d2072763a1477ee15011e3b5c6bf2c07d04a5ff3`** (replaces f52b493b…), registry re-rotated + verified on-chain (slots == 0x3862…/0x58da…/0x6b58…, admin set, vault 0, wagers []).
  - **RIPPLE**: notary .env.notary-{1,2,3} + .env.sample, read-registry default, ui deploy-info FALLBACK + ui/public (copy-keys), DEMO-PLAYBOOK.md → new address; sidecar restarted (health + state smoke green on 364a84dd…).
  - **FULL SUITE: 120 passed + 1 skipped** (contract 40, notary 26, api 32 incl. live browser join vs new contract, ui 22+1 opt-in skip).
  - Notable verification evidence: reference sentinel.compact actually pays SHIELDED (its README: unshielded contract deposits "not working" as of 2026-04) — our unshielded path was probe-verified independently (compile + simulator execution of receiveUnshielded/sendUnshielded/mintShieldedToken + effects observability + UserAddress 32-byte encoding). LIVE unshielded wallet-funding remains to be proven by the sidecar agent (Phase B) — contract-side behavior is fully simulator-proven.
- Blockers: none for contract scope. Live-path risk flag: reference app's 2026-04 note that unshielded deposits/withdrawals in contracts were "not working" — our stack versions differ; sidecar must verify wallet-funded unshielded receives on the devnet (Phase B).
- Artifacts: stride.compact v2 (real-token wagers + NFT), tests/stride.test.ts (40), sim.ts effects helpers, api index.ts v2 interface + userAddressBytes, README "Wager interface (v2)" + updated ABI, deploy-output.json (364a84dd…), rotated registry, sidecar restarted.
- Next session goal: hand off — sidecar agent wires live wagers (wallet-funded unshielded receives, payout address conversion, NFT display); UI fixture mode untouched.

**Gate for dependents:** compiled `pureCircuits` (schnorrChallenge) exported
+ Assertion encoding frozen (CONTRACT.md §2) + ABI/entrypoint README.
→ ALL MET (2026-08-06): pureCircuits.encodeAssertion/schnorrChallenge exported
from src/index.ts + managed/stride/contract; encoding frozen in assertion.compact
(field order is contract law); README written. Encoding UNCHANGED by Phase A
(window change is circuit-internal; signatures unaffected).

## Attestation workstream (docs/ATTESTATION.md)

- Status: **FIXTURE GATE CLOSED (session 3, 2026-08-07)** — OAuth DONE, 3 real Strava fixtures saved + offline-verified, notary pipeline GREEN with real Strava metrics
- Progress (session 3, 2026-08-07):
  - **OAUTH DONE (human clicked Authorize ~10s after browser opened)**: athlete Nicolás Ludueña, id 1390331368 (account created 2026-08-07T15:10:43Z). Tokens persisted to packages/client/.env (40-char access + refresh, ~6h expiry). **Refresh path verified live**: POST /oauth/token refresh_token → new tokens persisted → /athlete 200.
  - **Data blocker found + resolved by human**: the authorized account initially had ZERO activities (stats all zero; /athlete/activities → []); the human uploaded 5 real walks (June–July 2026, 2.4–3.9 km) to the account. No fabrication — real Strava data attested through the real API.
  - **3 STRAVA FIXTURES SAVED** (packages/client/fixtures/, source=live-strava, real attestations via local attestor + stwo):
    - `fixture-activity-19643821526-3900m.json` — 3900.3 m / 2942 s / 2026-07-02T23:00:06Z
    - `fixture-activity-19643821429-3545m.json` — 3544.6 m / 3010 s / 2026-07-22T23:31:58Z
    - `fixture-activity-19643822226-2426m.json` — 2426.3 m / 1825 s / 2026-06-21T00:01:27Z
    - Contrast selection: sorted by distance, picks max/mid/min (real contrast 3.90 km vs 2.43 km — no 5 km/10 km activities exist on the account).
  - **OFFLINE VERIFICATION: 3/3 GREEN** (`verify` CLI — identical crypto path, no attestor): identifiers 0x96210cee… / 0x304eeb24… / 0x2ab41b3d…
  - **NOTARY SANITY: 9/9 GREEN** (3 fixtures × 3 instances 8101/8102/8103): HTTP 200, metricSource=strava, claims metricId 0x1 (distance 3900/3545/2426 m) + 0x2 (moving_time 2942/3010/1825 s), claimCount=0x2, Jubjub-Schnorr sig present. **Determinism confirmed**: identical assertions across instances, 3 distinct signatures, matching identifiers. **NO extractor fixes needed** — notary assert.ts strava branch handles the real single-activity JSON shape.
  - Client fixes this session: `cmdFixtures` athleteId bug (was activity.id; now activity.athlete?.id → 1390331368) + contrast selection (pickForContrast).
  - Full suite: `pnpm -r test` **87 passed + 1 skipped** (contract 35, notary 23, api 21, ui 8+1, client no-test exit 0).
- Blockers: none for the attestation scope. (Demo-day note: token expires ~6h after issue; refresh path proven — `getValidAccessToken` auto-refreshes.)
- Artifacts: 3 Strava fixtures above + 3 github reserve fixtures (all offline-verified), packages/client/.env (tokens, secret), artifact-schema.md updated
- Next session goal: hand off — real Strava fixtures now available for the demo story (wager contrast 3900 m vs 2426 m); UI can embed the Strava fixture set if desired.

**Gate for dependents:** ≥3 fixture proofs saved in `client/fixtures/` +
`artifact-schema.md` + build-start verifications #1 (PRIVATE_KEY scheme) and
#2 (zk-fetch wiring) answered. → **FIXTURE GATE CLOSED (2026-08-07)**: 3 real
Strava fixtures saved + offline-verified; verifications #1/#2 answered;
artifact-schema.md complete.

## Notary/Client workstream (docs/NOTARY.md)

- Status: DONE (notary scope) + **Track 0.1 browser-wallet stack SHIPPED (2026-08-07)** + **CORS FIXED (2026-08-07, session 7)** + **LIVE WAGER E2E GREEN (2026-08-07, session 9 — Phase B): REAL unshielded NIGHT escrow + shielded winner NFT proven live; root cause of RpcError 192 found + fixed**
- Progress (session 9, 2026-08-07 — live unshielded escrow debugging):
  - **BUG (evidence):** on the fresh chain (contract cf80ad42…), attest/streak/badge worked but `createWager` → `RpcError: 1010 Invalid Transaction: Custom error: 192` (InputsSignaturesLengthMismatch). Instrumented probe (packages/api/scripts/unshielded-probe.ts) showed the finalized tx's fallible unshielded offer: `inputs=1 sigs=0` — the escrow input was added but NEVER signed.
  - **ROOT CAUSE (SDK citations):** providers.ts balanceTx signed recipes with a hand-rolled `signTransactionIntents` (reference-app pattern): `ledger.Intent.deserialize('signature','proof','pre-binding',…)` → sign → `intent.fallibleUnshieldedOffer = offer.addSignatures(sigs)` → `tx.intents.set(segment, cloned)`. The deserialize→mutate→set cycle replaced the WASM-backed intent object and the signatures did not survive `finalizeRecipe` (probe: finalized offer sigs=0). The wallet SDK's canonical path exists: `WalletFacade.signRecipe(recipe, signSegment)` (wallet-sdk-facade/dist/index.js:314) → `Transacting.signUnboundTransaction/signUnprovenTransaction` → `TransactionOps.addSignature` (wallet-sdk-unshielded-wallet/dist/v1/TransactionOps.js:41-58, in-place `offer.addSignatures` on the ACTUAL intent objects) → survives finalize. This is exactly the reference app's old note (unshielded contract deposits "not working" — their manual signing path never worked for unshielded either; they pay shielded only).
  - **FIX:** packages/contract/src/wallet.ts `createWalletAndMidnightProvider.balanceTx` now calls `ctx.wallet.signRecipe(recipe, signFn)` (signFn = unshieldedKeystore.signData) instead of the manual helper; `signTransactionIntents` left exported but unused (dead code, documented). Contract dist rebuilt; sidecar restarted.
  - **VERIFY:** probe createWager (1 NIGHT) landed twice (tx `7fc7f3523ec87ac8c52f5a30f0cc19228c597d4fc138f957a84ccc0eae942e47` + wagers 0/1 on-chain); pure-DUST path (attest, github fixture) still 200 (`ab4f19e3…`). Full suite: contract 40, notary 26, api 39, ui 22+1 skipped.
  - **LIVE WAGER E2E (the gate): ✅ PASSED** — real Strava walks (3545 m A vs 2426 m B), stake 10 NIGHT:
    - attest A (3545 m) vaultKey `0x3b8c3376…` · attest B (2426 m) vaultKey `0x74d63748…` (full attest tx hashes truncated by the script's log slice; credentials confirmed on-chain via /state vault)
    - create wager (id 0x2, stake 0x9184e72a000 = 10 NIGHT): tx `6fa269357a0d6624c30e4c365ea6cb7102858dce7049f76bf390a3cebad3d05a`
    - accept (B): tx `1b1c2705a7e7397e2105bfbeadf7bfdbfc1fec93d64fd7153f5f0c4b9c6248b9`
    - submit A (sealed 3545): tx `8dfa45fffd24c9148d77b2b72de5edc00a6bde698143ecd9402e99239eb022a5`
    - submit B (sealed 2426): tx `b42d9d626d6b4ce048174d97f602242f38f526c7c07ba7ac79e57415c07d9c41`
    - settle: tx `fe0ca99653b22b292b5dd4900a186749ee65aee08ce0dbcad02974cfc128418b` → **winner A, potNIGHT 0x12309ce54000 = 20 NIGHT, NFT tokenType `91f59aa0292ebfdfd8055392a204759fbb91c83291c2c2e294832bcc9c609f57`** (detected in A's shielded balance), disclosed {A: 0xdd9 (3545), B: 0x97a (2426)}
    - **BALANCE DELTAS (exact):** A 248 → 258 NIGHT (**+10**, net of −10 escrow + 20 payout) · B 250 → 240 NIGHT (**−10**, escrowed, lost)
    - GET /wagers shows id 0x2 settled/winner A + the 2 probe wagers; /state?athlete=A shows 3 vaulted credentials.
  - Fixtures regenerated (3 fresh Strava attestations; tokens auto-refreshed), sidecar restarted after wiping packages/api/midnight-level-db, E2E run backgrounded + polled (per timebox discipline).
- Remaining risk: none known on the live path. The 2 probe wagers (ids 0x0/0x1, opponent 0x1234, 1 NIGHT each) sit unaccepted on-chain (escrowed from seed ONE) — harmless; a future cancelWager could refund them.
- Artifacts: packages/contract/src/wallet.ts (signRecipe fix), packages/api/scripts/unshielded-probe.ts (instrumented repro), e2e-wager.ts, /tmp/opencode/{probe,probe2,probe3,e2e-wager}.log, fresh fixtures.
- Next session goal: demo-day per DEMO-PLAYBOOK.md (live wager beat now REAL: two-identity pot + NFT).
- Progress (session 7, 2026-08-07 — CORS):
  - **BUG (orchestrator curl evidence):** demo UI (:5173) → notaries (8101-8103) + sidecar (:8200) had NO CORS headers; OPTIONS preflight → 404; browser blocked every cross-origin call (notary strip 0/3, attest notarize never signed). Never caught: browser-path tests run in vitest/Node, which doesn't enforce CORS.
  - **FIX (both servers, identical logic):** `CORS_ALLOWED_ORIGINS` = localhost/127.0.0.1 × :5173 (vite dev) + :4173 (vite preview). On requests with a matching `Origin`: `Access-Control-Allow-Origin: <origin>` + `Access-Control-Allow-Methods: GET, POST, OPTIONS` + `Access-Control-Allow-Headers: content-type` + `Vary: Origin` on EVERY response (applied before routing, so 4xx/5xx too); `OPTIONS` (any path) → 204 with those headers. Non-matching origins: served normally WITHOUT headers (browser blocks — correct). Files: packages/notary/src/index.ts (createNotaryServer), packages/api/src/demo-sidecar.ts.
  - **TESTS:** notary server.test.ts +3 (OPTIONS 204+allow-origin, GET with allowed Origin → header, disallowed → no header); api demo-sidecar.test.ts +3 (same, fake-deps harness). Suite: contract 35, notary 26, api 32, ui 16+1 skipped = **109 passed + 1 skipped**.
  - **SERVICES RESTARTED** (old PIDs killed by port): notaries via `pnpm --filter @witnessfitness/notary start:instances` (log /tmp/opencode/notaries.log), sidecar via `pnpm --filter @witnessfitness/api start:sidecar` (log /tmp/opencode/sidecar.log, ready:true on f52b493b…). Attestor + devnet untouched.
  - **LIVE EVIDENCE:** `curl -i -X OPTIONS -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" ...` → 204 + allow-origin/methods/headers + Vary on :8101 and :8200 (spot-checked 8102/8103 too); GET /health with Origin → 200 + headers on both; GET /health with `Origin: http://evil.example` → 0 CORS headers (correct block).
  - **Track 0.3 retest (mode=wallet in the browser) READY for the human** — CORS was the only known browser-path blocker; wallet-bridge + ui code untouched by this fix.
- Progress (session 6, 2026-08-07 — Track 0.1):
  - **`packages/api/src/browser.ts`** (exported via package.json `exports` map `./browser`): `initializeProviders(connectedAPI)` — FetchZkConfigProvider at `${origin}/managed/stride`, `indexerPublicDataProvider`, `httpClientProofProvider(proverServerUri)` (direct-to-proof-server), in-memory private state, walletProvider (getCoinPublicKey/getEncryptionPublicKey from getShieldedAddresses; balanceTx via `balanceUnsealedTransaction` → `Transaction.deserialize('signature','proof','binding')`), midnightProvider.submitTx — mirrors reference browser.ts; wallet funds gas ONLY. `deriveBrowserHolderSecret()` = 32 random bytes via crypto.getRandomValues (never wallet-derived). `joinStrideFromBrowser(connectedAPI, contractAddress, privateStateId)` — fresh providers + zeros-admin (isAdmin requires adminSecret != 0 AND binding match → zero key can never be admin; verified in stride.compact).
  - **`packages/api/src/in-memory-private-state-provider.ts`** — reference-mirrored provider (scoped map, signing keys, full PrivateStateProvider interface incl. exportPrivateStates/importPrivateStates/exportSigningKeys/importSigningKeys) + Track 0.1 persistence hooks: `exportPrivateState(password, storeName)` → `{salt, iv, data}` base64 JSON (PBKDF2 100k iters SHA-256 → AES-GCM-256, WebCrypto only — no Buffer/node:crypto, browser-safe), `importPrivateState(password, storeName, payload)` (replace + validate), `resetPrivateState(storeName)`. bigint/Uint8Array-safe serialization (JSON.stringify can't do bigint).
  - **ui/package.json**: added exact-pinned deps (@midnight-ntwrk/dapp-connector-api@4.0.1, compact-runtime@0.16.0, ledger-v8@8.0.3, midnight-js-{contracts,fetch-zk-config-provider,http-client-proof-provider,indexer-public-data-provider,types}@4.1.1, @witnessfitness/api + @witnessfitness/contract workspace:*). copy-keys flow verified current (ui/public/managed/stride: 28 keys + zkir + compiler + deploy-output.json f52b493b…).
  - **Tests `packages/api/tests/browser.test.ts` 8/8** (api suite now 29/29; workspace 103 passed + 1 skipped): provider-slot assembly with stub ConnectedAPI; export→import roundtrip restores identical PrivateState (bigint/bytes); wrong password + malformed payload rejected; short password rejected; signing-key export/import; `deriveBrowserHolderSecret` uniqueness; **live joinStrideFromBrowser → readState against the devnet indexer (registry 3 keys, adminSecret set)** — full browser path incl. FetchZkConfigProvider served from dist/managed/stride.
  - Debug note: onchain-runtime WASM resolves crypto through `window` when it exists — a bare `window = {location}` stub traps `sampleSigningKey`; the test stub carries `crypto: globalThis.crypto` + `navigator: {userAgent}` (Apollo needs it too).
- Blockers: none. (Sidecar/notary/devnet verified healthy after the changes.)
- Artifacts: packages/api/src/{browser,in-memory-private-state-provider}.ts, packages/api/tests/browser.test.ts, package.json exports `./browser`, dist rebuilt, ui deps + refreshed copy-keys.
- Next session goal: UI agent wires the browser-wallet mode against the seam (import contract below); demo-day per DEMO-PLAYBOOK.md.
- Progress (session 1, 2026-08-06):
  - **ROUNDTRIP GATE GREEN (notary pipeline → contract simulator)**: tests/roundtrip.test.ts — fixture proof → verifyReclaimProof (attestor-core SDK) → buildAssertion → sign (CSPRNG k) → simulator accepts 3-of-3 AND every 2-of-3 pair across BOTH fixtures; 1-of-3 rejected; tampered assertion rejected; unregistered key rejected; vault entry + nonce replay verified. 22/22 notary tests (verify-reclaim 6, assert 4, server 6, roundtrip 6).
  - packages/notary shipped: src/{config,verify-reclaim,assert,sign,index}.ts + tests/ + .env.sample. POST /attestate {proofArtifacts} → {assertion, signature, notaryId, metricSource, identifier}; GET /health; GET /pubkey. Wire format: bigint → 0x-hex, Uint8Array → 0x-hex (deep jsonSafe — a JSON.stringify replacer alone can't catch Buffers: toJSON fires first). Artifact shapes accepted: fixture file shape (claim/signatureHex/attestorAddress), zk-fetch transformProof shape (claimData/signatures[]/witnesses[]), and the UI's ProofArtifacts shape (claimSignatureHex alias — verified live against all 3 instances).
  - Determinism design (2-of-3 prerequisite): nonce + reclaimProofHash derived from the VERIFIED ARTIFACTS (sha256), so all 3 instances sign the IDENTICAL assertion; k is fresh CSPRNG per signature. Verified live: all 3 instances returned byte-identical assertions with distinct signatures.
  - Key format fix: runtime ecMulGenerator rejects scalars ≥ JUBJUB_ORDER — secretKeyFromHex reduces mod (order-1)+1 (same pattern as contract's deriveNonce).
  - **3 INSTANCES RUNNING**: ports 8101/8102/8103, env files .env.notary-1/2/3 (NOTARY_KEY 32B hex, NOTARY_ID, PORT, ATTESTOR_URL, CONTRACT_ADDRESS, NODE_URL, INDEXER_URL, PROOF_SERVER_URL; ALLOWED_HOSTS default strava + fixture hosts). /health + /pubkey verified via curl; /attestate signed the coingecko fixture on all 3. `pnpm --filter @witnessfitness/notary start:instances` restarts them.
  - **KEY REGISTRATION DECISION: ROTATE (not redeploy)** — kept the canonical address e7c29674956f2e1e380d0378360ee14f763a698d66c1ac16da082427002b2f89 (superseded 2026-08-07 Phase A: redeploy to 876edadee… for the 30-day freshness window, then re-rotated). New script packages/contract/scripts/rotate-notaries.ts (`pnpm --filter @witnessfitness/contract run rotate-notaries`) fetches the 3 running instances' /pubkey and rotates slots 0-2 as admin. Registry VERIFIED on-chain via indexer: x-coords == the 3 instance pubkeys. deploy-output.json updated (notaryPublicKeys + notaryInstances + registryRotatedAt). Keys themselves stay in .env.notary-* (gitignored via `.env.*`).
  - **LIVE E2E SUCCESS (timeboxed)**: packages/api/scripts/e2e-attest.ts (`pnpm --filter @witnessfitness/api run e2e:attest`) — coingecko fixture → 3/3 notary signatures → join deployed contract → verifyAttestation → tx ca5320b282a4e067a13430a82381ab3b12c86858ba96a803ee7e3919c510485b → on-chain vault.member(vaultKey) == true.
  - packages/api shipped: StrideContract wrapper (deploy/join/readState/state$ + all callTx entrypoints + verifyAttestationWith), NotaryClient (≥2-of-3 collection, identical-assertion check, dummy-sig slot filling), demo flows: attestWorkout / createWagerFlow / acceptWagerFlow / cancelWagerFlow / submitWorkoutFlow / settleWagerFlow / advanceStreakFlow / mintBadgeFlow / proveBadgeFlow. api tests 5/5 (wire roundtrip → simulator accepted; downed instance degrades to 2; inconsistent assertions rejected; <2 rejected).
  - Build fixes (evidence-backed): tsconfig.build.json in contract/api/notary inherited `noEmit: true` from tsconfig.base.json → tsc emitted nothing → dist was just copied assets; also `allowJs: true` made tsc regenerate managed .d.ts into dist. Fixed: noEmit: false + allowJs: false in all three build configs. Contract dist rebuilt with PLONK keys preserved (28 key files).
- Blockers: none for notary scope. Live Strava fixtures still pending OAuth (attestation workstream) — identical crypto path, zero code change expected (strava hosts already allowlisted; strava metric extractor implemented in assert.ts).
- Artifacts: packages/notary/{src,tests,.env.sample,.env.notary-1..3}, packages/api/{src/index.ts,scripts/e2e-attest.ts,tests/notary-client.test.ts}, packages/contract/scripts/rotate-notaries.ts + updated deploy-output.json, contract dist rebuild.
- Next session goal: hand off to UI agent (api is the interface; live-client wiring now possible). Optional: live Strava fixture swap-in + rerun e2e.

## UI/Demo workstream (docs/UI-DEMO.md)

- Status: **LIVE WAGERS SHIPPED (Phase C, session 8) — real NIGHT stakes + shielded NFT in the live Wagers tab; 30/31 ui tests, mapping validated against the real sidecar** · **Phase C real Strava E2E (tx `3c105361…`)** · **Track 0.2 wallet mode shipped** · **restore/resume polished (session 7)**
- Progress (session 8, 2026-08-07 — live wagers):
  - **live-client.ts**: the five wager methods hit the sidecar's `/wager/{create,accept,submit,settle}` + `/wagers` (WfClient interface unchanged). createWager → `{athlete:'A', opponent: letter, stake: hex(display×10^12 NIGHT), deadlineBlock: hex(unix+90s)}`; acceptWager resolves the opponent letter from /wagers; submitWorkout(id, athlete) — the credentialId arg carries the acting identity ('A'|'B'); settleWager maps `{winner, potNIGHT, nft, disclosed}` → WagerResult (pot display NIGHT, currency, comparison, NFT data); listWagers maps statuses + envelopes + unknown bindings → synthetic identities. hexOf/athleteLetter/nightToDisplay exported.
  - **WagersScreen (live)**: "demo-only" notice GONE — roster card with copyable challenge IDs (A/B) + challenge-by-ID create input (validates A/B); stake default 10 NIGHT, deadline 90s; per-athlete "Seal submission" buttons (both identities driven from the screen); settle countdown (deadline + 60s grace, 1s tick) locking the settle button; reveal reuses the envelope components with currency-aware pot + the shielded NFT card ("Winner receives the WitnessFitness NFT — a shielded coin they can prove they own").
  - **RevealSettle**: WagerResult.currency ('tNIGHT' fixture / 'NIGHT' live); NFT card when result.nft present. **domain/types.ts**: WagerResult gains currency + nft.
  - **wager-countdown.ts** (new): settleReadyAtMs / formatCountdown / challengeIdOf. **Tests**: +8 (live-wager.test.ts — stubbed sidecar full flow + mapping + verbatim 4xx + countdown + challenge parsing + NIGHT base). Full ui suite **30/30 + 1 rehearsal skip**; tsc clean; vite build 3.6s.
  - **Real-sidecar read-only probe**: /wagers mapping verified live — Phase B E2E wager #2 renders settled (Ava vs Milo, 10 NIGHT, 2 submissions, winner Ava); unknown-binding wagers render as synthetic identities. No new chain state burned.
  - Docs: ui/README.md (live-wager section + limits corrected), DEMO-PLAYBOOK.md (fallback matrix + §7 limits rewritten for live wagers).
- Progress (session 7, 2026-08-07 — wallet-mode restore/resume UX polish, surgical):
  - **Restore redesigned**: ONE always-visible "Restore backup" button in the wallet panel — disabled with the hint "no backup stored for this wallet" when absent; click loads the payload AUTOMATICALLY from localStorage (`wf-wallet-backup-<addr-suffix>`); the paste-textarea/file-picker/download affordances are GONE. Restore = password prompt → `restorePrivateState(password, storedPayload)` → "Private state restored — vault is back." / wrong password → inline error. The stored backup is only ever READ — a wrong password cannot wipe it.
  - **Auto-resume**: on reload/connect, if a backup exists for the wallet address AND no live credentials AND not prompted this session → the same password prompt opens automatically in "resume" mode; dismiss → no restore; never auto-restores without the password; `useRef` guard vs double-prompt; `restoreBusy` blocks concurrent restores.
  - **New pure module** `ui/src/lib/wallet-restore.ts`: walletBackupKey / readStoredBackup / storeBackupPayload / hasStoredBackup / performRestore (payload always from storage, never user input) / shouldAutoResume — testable without a DOM lib. ConnectScreen delegates to it; backup flow unchanged (no download).
  - **Tests**: +6 (key determinism, store/read roundtrip, performRestore passes the STORED payload to the bridge, no-backup rejection, wrong-password preserves backup, auto-resume decision matrix) with a localStorage shim. Full ui suite **22/22** (fixture 5 + live 3 + wallet 14), rehearsal skipped; tsc clean; vite build 2.9s; headless smoke: wallet + fixture mount.
  - Untouched: wallet-bridge.ts, wallet-connector.ts, wallet-client.ts (bridge call signatures unchanged), backend, contract, other screens.
- Progress (session 6, 2026-08-07 — Track 0.2, browser-wallet mode):
  - **wallet-connector.ts**: DApp Connector flow — window.midnight discovery, apiVersion check, authorize, network check, connect/disconnect + status$; no-wallet → existing switch-to-demo CTA.
  - **wallet-bridge.ts**: typed seam against `@witnessfitness/api/browser` (initializeProviders, joinStrideFromBrowser, deriveBrowserHolderSecret, export/import/reset private state) with local type-stub fallback until the real module resolves.
  - **wallet-client.ts**: mode=wallet WfClient implementation — holder secret via deriveBrowserHolderSecret on first connect (per wallet address), privateStateId = address-derived; attest/vault/streak/badge flows via joinStrideFromBrowser + api flows; backup/resume UX (Back up / Restore with password → exportPrivateState/importPrivateState); wagers stay fixture-mode (Track 1).
  - **wf-factory.ts**: third mode `wallet` (lazy-imported WalletClient, like live).
  - **ConnectScreen.tsx**: wallet-mode panel — Connect/Authorize, wallet address + network display, backup + restore controls.
  - **Tests**: wallet-mode.test.ts 8/8 (discovery/authorize happy path, no-wallet CTA, holder-secret determinism per address, export/import roundtrip, backup-not-supported guards); existing live 3/3 + fixture 5/5 unchanged. 16 passed + 1 opt-in rehearsal skip.
  - **Docs**: ui/README.md wallet-mode section (setup, backup/resume, gas-only wallet, limits); docs/DEMO-PLAYBOOK.md §1.5 browser-wallet setup (Lace restore phrases for seeds ONE/TWO/THREE) + fallback matrix (fixture / live / wallet).
- Blockers: none. Demo-day dependency: regenerate fixtures morning-of (Strava creds now on the machine — the fixture gate is CLOSED) so the live attest has a fresh one-shot fixture. (The Phase B E2E wager is already settled — create a fresh one from the screen for the demo's live wager beat.)
- Artifacts: (session 8) ui/src/lib/{live-client,chain}.ts wager endpoints, wager-countdown.ts, live-wager.test.ts, WagersScreen.tsx, RevealSettle.tsx, domain/types.ts; (earlier) wallet-connector/bridge/client/restore + wf-factory (3 modes), ConnectScreen.tsx, ui/README.md, docs/DEMO-PLAYBOOK.md
- Next session goal: full live demo rehearsal of the wager beat (create → accept → seal A → seal B → countdown → settle → NFT card); Track 0.3 wallet E2E with restored Lace; hook GIF capture.

## Hard gates

- **Phase B live wager (REAL NIGHT + shielded NFT): MET (2026-08-07)** — two-identity live wager E2E GREEN on cf80ad42…: A(3545m) vs B(2426m), stake 10 NIGHT, winner A, pot 20 NIGHT paid (A +10 net, B −10), NFT tokenType `91f59aa0…` minted to A. Root cause of RpcError 192 (InputsSignaturesLengthMismatch) fixed in wallet.ts (SDK-native `signRecipe` replaces the reference's hand-rolled intent-signing that dropped unshielded offer signatures).
- **CORS for browser demo paths: MET (2026-08-07)** — notaries (8101-8103) + sidecar (:8200) send CORS headers for the demo UI origins (localhost/127.0.0.1 × :5173/:4173), OPTIONS preflight → 204; disallowed origins get no headers. Tests +3/+3; services restarted with the fix; live curl evidence green. Track 0.3 browser retest (mode=wallet) ready for the human.
- **Track 0.1 browser-wallet provider stack: MET (2026-08-07)** — `@witnessfitness/api/browser` shipped (initializeProviders / joinStrideFromBrowser / deriveBrowserHolderSecret / in-memory private state with password-encrypted export-import); tests 8/8 incl. live join + readState on devnet; ui deps pinned + copy-keys verified; sidecar/notary paths untouched (suite 103 passed + 1 skipped).
- **Track 0.2 wallet-mode UI + restore/resume: MET (2026-08-07)** — mode=wallet end-to-end in the UI (connector, bridge seam with stub fallback, wallet client, backup/resume); restore UX polished (one-button restore from the stored backup, auto-resume password prompt, wrong password preserves the backup); ui suite 22/22 + tsc + build + headless smoke green. Remaining: real-Lace smoke when a human restores the wallet phrases (playbook §1.5).
- **Phase C live wagers: MET (2026-08-07)** — live-mode Wagers tab runs the REAL on-chain wager (sidecar identities A/B, unshielded NIGHT stakes, shielded WitnessFitness NFT to the winner, sealed settle with disclosed comparison); mapping validated against the live sidecar (E2E wager #2 settles Ava vs Milo 10 NIGHT); ui suite 30/30 + tsc + build green. Acceptance #3 (live wager settles sealed; replay fails) now covered by a live UI path in addition to the simulator/fixture coverage.
- **Track 0.2 UI wallet mode: MET (2026-08-07)** — mode=wallet shipped (wallet-connector DApp Connector flow, wallet-client, backup/resume with password-encrypted private state, ConnectScreen panel); ui tests 16 passed + 1 skip, tsc clean, vite build green; docs (ui/README + playbook §1.5 + fallback matrix) written. Track 0.3 (Lace restore + live E2E) = human step: phrases in docs/DEMO-PLAYBOOK.md §1.5.
- Signature-parity roundtrip (simulator, ARCHITECTURE.md §4): **GREEN** (2026-08-06) — contract suite 4/4 AND notary-pipeline suite 6/6 (tests/roundtrip.test.ts): fixture → verify-reclaim → assert → sign → accepted in-circuit for 3-of-3 and every 2-of-3 pair; tampered/unregistered/1-of-3 rejected. Notary signing parity path proven end-to-end. Unaffected by Phase A (encoding unchanged).
- Notary instances + key registration (NOTARY.md §7): **DONE** — 3 instances running (8101-8103), registry rotated on-chain to the running instances' keys. **RE-ROTATED (2026-08-07, session 5) on the real-token contract `364a84dd…`** — verified on-chain via read-registry.ts: slots == instance pubkeys (0x3862…/0x58da…/0x6b58…).
- Live E2E verifyAttestation on devnet: **GREEN** — tx `ca5320b2…` (pre-Phase-A), tx `7382c9ef…` (Phase A contract), **post-recovery tx `46513c65336fe8f150376c07bee21ef45a77d1ce96ee50a455dabab2714fe4f1` (2026-08-07, contract f52b493b…)** — vault contains credential; streak/advance GREEN (streakCount 1). **Node corruption incident RESOLVED** (chain reset + redeploy + rotation; see Contract section).
- Node ledger-DB corruption incident: **RESOLVED (2026-08-07)** — reproduced live (arena trap on /attest), chain reset via `devnet:down`+`up` (compose has no volumes), redeployed f52b493b…, re-rotated, live submit path GREEN (attest + streak/advance verified). Procedure validated end-to-end; DEMO-PLAYBOOK.md §2 updated with the new address.
- Fixture proofs saved by Day 1 PM: **CLOSED (2026-08-07)** — 3 real Strava fixtures saved in packages/client/fixtures/ (3900 m / 3545 m / 2426 m walks, athlete 1390331368) + offline-verified + notary sanity 9/9 GREEN with real distance/moving_time claims. OAuth complete (access+refresh tokens, refresh path proven).
- Build-start verification #1 (PRIVATE_KEY scheme): ANSWERED (see Attestation section)
- Build-start verification #2 (zk-fetch wiring): ANSWERED (see Attestation section)
- No E2E wiring until roundtrip test is green: enforced
- UI fixture-mode demo end-to-end (5/5 screens, smoke tests green): MET (2026-08-06) — ui/README.md demo script + docs/PITCH.md drafted; live mode blocked only on notary instances responding.
- UI live path → demo sidecar (:8200): WIRED (2026-08-07) — code complete, no Lace wallet; live smoke pending the sidecar process (not running yet). Smoke commands in ui/README.md.
- Phase D demo readiness: **PLAYBOOK + REHEARSAL DONE (2026-08-07)** — docs/DEMO-PLAYBOOK.md (start order, health checks, key backups, incident recovery, rehearsal notes, GIF instructions), fixture path fully green (8/8, build, headless), live submit path GREEN post-recovery (attest tx `46513c65…` recovery + `e7fe84a6…` UI-payload rehearsal; streak/advance 200; badge predicates enforced in-circuit).
- **Acceptance #5 (AGENTS.md §7 — 7-min script rehearsed twice: live + fallback): MET (2026-08-07)** — live path rehearsed end-to-end on the healthy chain f52b493b… (attest → vault → streak-advance → badge denials, tx hashes in DEMO-PLAYBOOK.md §9); fixture path rehearsed (8/8 tests, ~90s story, headless smoke).
- **Acceptance #2 (E2E: real attestation → ≥2 notary sigs → on-chain verifyAttestation → vaulted credential) FULLY CLOSED (2026-08-07, Phase C)** — REAL Strava walk 3.90 km/2942 s attested on-chain: tx `3c1053617f63380011c824e692493f762d7dea3014a5434ac92069f35bbb0e31`, vaultKey `0x50b5c4ac…eabc84`, metrics [{distance 3900}, {moving_time 2942}] — real values sealed in the vault. Fixture gate CLOSED (3 real Strava fixtures, offline-verified). Demo-day dependency: regenerate fixtures morning-of for a fresh one-shot attest.

## Escalation

Disproven documented facts only (AGENTS.md working rules). Everything else
is decided — do not re-litigate.

## Orchestrator summary (2026-08-07, final — Tracks 0-2 complete)

**Acceptance criteria status (AGENTS.md §7):**

| # | Criterion | Status |
|---|---|---|
| 1 | Contract simulator tests green | ✅ **40/40** (incl. real-token wager suite + 30-day freshness + parity) |
| 2 | E2E attestation → ≥2 notary sigs → on-chain vault | ✅ real Strava walks vaulted on-chain (latest tx trail on cf80ad42…) |
| 3 | Live wager settles sealed; replay fails | ✅ **LIVE with REAL NIGHT + shielded NFT** — settle tx `fe0ca996…`, pot 20 NIGHT, A 248→258 / B 250→240, NFT tokenType `91f59aa0…`; nullifier replay tested |
| 4 | Streak + badge + proveBadge | ✅ simulator + mock employer panel + live predicate denials |
| 5 | Demo script rehearsed twice + pitch | ✅ `ui/README.md` + `docs/DEMO-PLAYBOOK.md` (both paths), `docs/PITCH.md` (hybrid-pot narrative added) |
| 6 | Secrets only in .env, never committed | ✅ zero commits; admin-secret.local + .env* gitignored |

Full suite: **135 passed + 1 skipped** (contract 40, notary 26, api 39, ui 30+1).

**Live stack (post chain-fork reset, 2026-08-07):** fresh devnet; contract
**cf80ad421b2b85f6ca1b3c0ccfd140ae5f6fc0d5871426d7750df4d42944cbaf** (30-day
freshness; real unshielded pot + shielded NFT) with 3 notary keys rotated
on-chain; notaries 8101-8103; attestor :8001; sidecar :8200 (identities A =
seed ONE, B = seed TWO, 250 NIGHT each). Three UI modes: fixture (default),
live (sidecar), wallet (Lace DApp Connector + password-encrypted backup/restore).

**Notable fixes this sprint:** NotaryClient slot mapping (URL-order, was
completion-order); CORS on notary + sidecar (browser paths); wallet-mode
restore/resume UX; chain-fork recovery (node/indexer desync → full reset);
**DUST double-spend** after restarts (fresh registration via full wallet
re-init); **InputsSignaturesLengthMismatch (192)** — root cause: the
reference-app's hand-rolled offer-signing path dropped signatures on
`finalizeRecipe`; fixed with SDK-native `WalletFacade.signRecipe` (the exact
gap behind the reference's old "unshielded deposits not working" note).

**Housekeeping:** 2 probe wagers (1 NIGHT each, opponent 0x1234) sit unaccepted
on-chain — harmless; `cancelWager` refunds them if ever needed. Regenerate the
3 Strava fixtures demo-morning (one-shot nonces; the CLI lingers after
completing — kill via `pgrep -f "client.*src/inde[x].ts"`).

## Orchestrator summary (2026-08-06, after all four workstreams)

**Acceptance criteria status (AGENTS.md §7):**

| # | Criterion | Status |
|---|---|---|
| 1 | Contract simulator tests green (2-of-3, tamper, replay, stale, wager, streak, proveBadge) | ✅ **40/40** (incl. real-token wager + NFT suite) |
| 2 | E2E attestation → 2 notary sigs → on-chain verifyAttestation → vaulted credential | ✅ **FULLY CLOSED (2026-08-07, Phase C): REAL Strava walk 3.90 km/2942 s on-chain** — tx `3c105361…`, vaultKey `0x50b5c4ac…`; prior fixture-based E2Es: `ca5320b2…`, `7382c9ef…`, `46513c65…`, `e7fe84a6…` |
| 3 | Live wager settles sealed; replay fails | ✅ simulator (real-token pot: escrow/payout/NFT effects proven; **simulated balances DELETED**) + fixture-mode UI; live single-wallet settle limitation documented; sidecar live-wager wiring = Phase B |
| 4 | Streak + badge + proveBadge verified by third party | ✅ simulator + mock employer panel |
| 5 | Demo script with fallbacks + pitch | ✅ **rehearsed twice (live + fallback) 2026-08-07** — `ui/README.md` (7-min script), `docs/DEMO-PLAYBOOK.md` (morning checklist + rehearsal notes + tx evidence), `docs/PITCH.md` |
| 6 | Secrets only in `.env`, never committed | ✅ zero commits made; `.env*` + `admin-secret.local` gitignored; admin secret moved out of committed deploy-output.json (2026-08-07) |

Full suite: **120 passed + 1 skipped** (contract 40, notary 26, api 32, ui 22 + 1 opt-in rehearsal skip) — `pnpm test` at root (2026-08-07, post-Phase-A-real-token).

**Live stack (2026-08-07):** devnet up; contract **`364a84dd0bc065d7ea25fd45d2072763a1477ee15011e3b5c6bf2c07d04a5ff3`** (real-token wagers + winner NFT; 30-day freshness window) with 3 notary keys rotated on-chain (instances 0x3862…/0x58da…/0x6b58…); notaries on 8101/8102/8103; attestor on ws://localhost:8001/ws; sidecar on :8200 (new address, health + state smoke green); admin secret in packages/contract/admin-secret.local (gitignored). Simulated wager balances retired — pots are real unshielded NIGHT (sidecar live-wager wiring = Phase B).

**Human actions completed (2026-08-07):** Strava app credentials pasted into packages/client/.env; OAuth Authorize clicked (athlete Nicolás Ludueña 1390331368); 5 real walks uploaded to the account (2.4–3.9 km). Fixture gate CLOSED — 3 real Strava fixtures in packages/client/fixtures/ (see Attestation section). Demo-day token refresh: proven live (auto-refresh in `getValidAccessToken`).

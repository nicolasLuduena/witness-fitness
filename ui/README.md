# ui — WitnessFitness demo frontend

React + Vite (browser DApp) for the demo: **Connect · Vault · Wagers · Streaks & Badges · Employer Panel**, under the dark "sealed envelope" aesthetic. Privacy is the product — the UI says it.

Run:

```bash
pnpm dev:ui            # copy-keys (ZK artifacts + deploy-output.json → public/) + vite on :5173
```

Modes (decided at startup — no runtime switcher):

| Mode | What runs | When to use |
|---|---|---|
| `wallet` (**default**) | **Browser wallet (Lace / DApp Connector)** — the wallet only funds gas (DUST/NIGHT); the app identity is a random 32-byte holder secret (never derived from wallet keys, nothing linkable on-chain). Private state is password-encrypted (WebCrypto AES-GCM, PBKDF2) and exportable/importable so a user can back up and resume. | The demo (a Midnight wallet extension must be installed) |
| `live` (`?mode=live` or `VITE_WF_MODE=live`) | The **demo sidecar** on `:8200` (packages/api) does everything on-chain: notary collection (2-of-3) → contract submit → vault → wagers. The browser only does typed fetch calls. **No Lace wallet required.** | Maintainer debugging only |

### Browser wallet mode (wallet)

Requires a Midnight-compatible wallet extension (e.g. Lace) installed, pointed at
the local devnet network, and holding DUST for fees. Flow:

1. Connect: discovery (`window.midnight`) → authorize → network check.
2. First connect generates the holder secret (random 32 bytes, per wallet address)
   and stores it inside the encrypted private state.
3. **Back up** ("Back up private state" on the Connect screen): password → exports a
   `{salt, iv, data}` payload (copy it / store it in localStorage).
4. **Resume** ("Restore"): paste payload + password → private state (notarized
   attestation, holder secret, commit randomness) is re-imported; the same wallet
   address resumes the same identity.
5. Wallet addresses never appear on-chain — the contract only sees the
   `hashToCurve(holderSecret)` binding. The wallet is gas-only.

#### Attestation (Round 2D — real browser Strava)

The Connect tab drives the REAL attestation path (`ui/src/lib/attest/*`):

1. **Connect Strava** — OAuth through the stateless service (`:8200`); the
   redirect lands on `<origin>/strava/callback` (the SPA fallback serves it —
   verified) and `handleStravaRedirect()` exchanges the code. The Strava
   **client secret never touches the browser**.
2. **Attest workout** — `attestStrava(accessToken)` witnesses a real TLS
   session via the local attestor (ws://localhost:8001/ws), generates the stwo
   ZK proof in-browser (vendored wasm — see the "Attestation (browser)"
   section), the 3 notaries re-sign (2-of-3), and the wallet signs the
   `verifyAttestation` tx. The identity card shows the dynamic Strava athlete
   name; the holder binding is your **challenge ID**.
3. **Empty-account guard** — an authorized Strava account with zero activities
   is rejected with a clear message (no fabricated data — real API check).
4. The staged pipeline card lights up: Strava account check → TLS witness →
   notarize (2-of-3) → on-chain vault.

#### Wagers (Round 2D — two browsers, one stateless relay)

Wallet-mode wagers are REAL on-chain duels between **two browsers** (the live
sidecar's A/B identities are NOT used here):

1. **Challenge**: paste the opponent's holder-binding challenge ID (their
   Connect tab — `0x` + 64 hex) into the create modal. Your stake escrows real
   NIGHT; your payout + coin key (NFT recipient) come from YOUR wallet. The
   deadline must be in the future (contract-enforced).
2. **Accept**: the other browser accepts from its own wallet (the contract
   binds the challenger/opponent roles) — accepting after the deadline is
   rejected ("Wager closed").
3. **Seal**: each side seals its own submission with its latest attested
   workout **before the deadline** (the contract rejects post-deadline
   submissions — "Deadline passed"; the UI locks the Seal buttons at the
   deadline). The contract seals `persistentCommit(value, submissionRand)` — a
   fresh 32-byte rand staged into the private state — and each side relays its
   (value, rand) opening to `:8200 /wager-openings` immediately.
4. **Settle**: either side settles once the deadline + 60 s grace has passed
   and both openings have arrived (the relay is polled until both are present;
   countdown UI locks until deadline+grace). Both openings are staged into the
   settler's private-state `wagerOpenings` (challenger first — contract law)
   and `settleWager` pays 2×stake + the shielded NFT to the winner. The chain
   publishes both opening values at settlement (sealed until then — never
   before); the comparison is displayed in the settling browser.

The opening relay is a dumb in-memory exchange (TTL 30 min) — it never sees
the wallet or the chain.

Limits: the winner NFT mints to the winner's coin key and is not observable
from the wallet's contract view (no NFT card in the wallet-mode reveal);
the per-wager (value, rand) openings live in the client session, not the
password backup.

### Start the sidecar (live mode)

Built in `packages/api`; needs the devnet + 3 notary instances up first (full
start order + health checks: `docs/DEMO-PLAYBOOK.md`):

```bash
pnpm --filter @witnessfitness/api start:sidecar   # reads deploy-output.json at startup
curl http://127.0.0.1:8200/health                # { ok, ready, contractAddress, network }
```

The UI reads the contract address from the sidecar's `/health` (and the notary strip reads `deploy-output.json`, copied to `public/` at dev/build time) — so a contract redeploy needs **no UI change**.

## Demo script (~7 minutes) with fallback triggers

The demo is live-only; `?mode=live` is the maintainer's debug path (identity sidecar).

| Time | Beat | How | Fallback if broken |
|---|---|---|---|
| 0:00 | Pitch hook | "The chain is about to compare two workouts it can't see." | — |
| 0:15 | Connect — attest | Connect Lace → "Connect Strava & attest workout" → watch the staged pipeline: *witnessing TLS → notarizing (2-of-3) → vaulting*. The "real crypto happening live" moment. | Wallet unavailable → the Connect screen explains what is needed. |
| 1:00 | Vault | Credential landed, sealed; hover the envelope → commitment on-chain. Chips are provable claims, never raw values. | — |
| 1:30 | Create wager | Roster challenge (Ava/Milo, copyable challenge IDs A/B) or challenge-by-ID input; stake 10 NIGHT; deadline ~90 s with an on-screen countdown (live mode). | Live: if the sidecar is down → the Connect screen explains. |
| 2:30 | Sealed submissions | Both athletes' envelopes seal on-screen (two explicit seal buttons, live mode). | Live: if the sidecar is down → the Connect screen explains. |
| 3:00 | Settle + reveal | "Settle — reveal winner under seal". Beat 1: winner + pot (real NIGHT). Beat 2: **"find the losing number"** — winner value shown, loser masked, room cannot guess. Beat 3: "athletes choose to disclose" — comparison appears with the honest framing: *the ledger never revealed it*. Winner also receives the shielded WitnessFitness NFT. | Live: if the sidecar is down → the Connect screen explains. |
| 4:00 | Streak + badge | Streaks tab: "Attest today → advance" (2→3), chain link seals 🔥. `mintBadge(1)` — Streak of 3 mints. | Same path; live mode goes through the sidecar (`/streak/advance`, `/badge/mint`). |
| 5:00 | proveBadge to mock employer | Employer Panel tab: run `proveBadge(1, verifier)` — transcript fills with on-chain receipts; streak data stays sealed (🔒 line). | Same path; live mode through the sidecar (`/badge/prove`). |
| 5:45 | Notary strip | Bottom strip: 3 keys (read from `deploy-output.json` — survives redeploys), live health, "threshold 2-of-3". | Strip always renders; live mode shows unreachable keys in red. |
| 6:15 | Business | B2B2C one-liner (docs/PITCH.md): employer wellness pays, platform never sees health data. | — |

**Rehearsal rule:** rehearse the wallet path (default) and the maintainer `?mode=live` path separately before demo day.

## The client wrapper (integration contract)

All backend calls go through `src/lib/wf-client.ts` (`WfClient`). Implementations:

- `src/lib/wallet-client.ts` — the default: browser wallet (Lace / DApp Connector) via the api workstream's browser bridge.
- `src/lib/live-client.ts` — the maintainer debug path: delegates to the **demo sidecar** (`src/lib/chain.ts`), which owns every on-chain concern. **Wagers are LIVE (Phase C)**: `createWager`/`acceptWager`/`submitWorkout`/`settleWager`/`listWagers` hit the sidecar's `/wager/*` endpoints; stakes are real unshielded NIGHT (10 NIGHT default, base 10^12), the winner takes the pot plus a shielded WitnessFitness NFT, and the settle response's `disclosed` values feed the honest reveal. `submitWorkout(id, athlete)` — the second arg is the acting sidecar identity ('A' or 'B').
- `src/lib/chain.ts` — the sidecar delegation layer: `GET /health`, `POST /attest { artifacts }`, `POST /streak/advance { vaultKey }`, `POST /badge/mint { vaultKey, badgeId }`, `POST /badge/prove { badgeId }`, `GET /state`. Timeboxed (12 s) with a typed `SidecarOfflineError` so failures render as the "demo service offline — switch to demo mode" state. Wire values are parsed leniently (number or 0x-hex; epoch s or ms).
- `src/lib/deploy-info.ts` — notary strip registry facts from `public/deploy-output.json` (copied from `packages/contract/deploy-output.json` by copy-keys), with embedded fallback constants for offline cold starts.

### `/attest` artifacts payload

Live mode (maintainer debug) sends proof artifacts to the sidecar's `/attest`:

```jsonc
{
  "artifacts": {
    "claim": { /* ProviderClaimData from the fixture */ },
    "signatureHex": "0x…",             // attestor's EIP-191 sig over the claim
    "attestorAddress": "0x…",          // lowercased ETH address
    "request": { "url": "…", "method": "GET", "publicHeaders": {} },
    "responseText": "HTTP/1.1 200 …",  // full captured response (notary needs it)
    "extractedParameterValues": { "data": "…" }
  }
}
```

Expected response: `{ vaultKey, txHash, timestamp, metrics: [{ metricId, label, value }] }`.

## Notes for the other agents

- **Sidecar agent (packages/api):** the UI is built against the stable contract above. If any field name deviates when you wire it, adapt the lenient parsers in `chain.ts` (they tolerate number/hex/seconds variants) and flag the diff in STATUS.md.
- **Contract agent:** nothing needed — the UI reads the contract address from the sidecar `/health` and the strip from `deploy-output.json`; a redeploy needs no UI change.
- **Attestation agent:** live attestations flow through the attest workstream's module (`ui/src/lib/attest/*`) — no proof artifacts are embedded in the UI.

## Live smoke (run when the sidecar is up)

```bash
curl http://127.0.0.1:8200/health                        # { ok, contractAddress, network }
pnpm dev:ui                                              # then open http://localhost:5173/?mode=live
# click "Connect to demo service" → "Connect Strava & attest workout"
# expect: vaultKey + txHash + metric chips in the pipeline card, credential in Vault
```

## Layout

```
ui/src/
├── config.ts            # env: mode, sidecar URL, notary ports
├── domain/              # types + static display constants (story.ts)
├── lib/                 # wf-client (contract), wallet/live clients, chain (sidecar), deploy-info, notary-api, format
├── state/DemoStore.tsx  # single source of truth for all screens
├── components/          # Envelope, NotaryStrip, StatusLine, RevealSettle, bits
├── screens/             # Connect, Vault, Wagers, Streaks, Employer
└── styles.css           # the sealed-envelope design system
```

## Attestation (browser)

Round 1C module — `ui/src/lib/attest/*` — the SPA's own attestation path
(Strava OAuth → real attestation → notary strip), ported from
`packages/client/src/{attest,strava}.ts` with two deliberate differences:

- **The attestor private key never touches the browser.** `buildAttestorClient`
  fetches a signed auth request from the stateless service
  (`POST {sidecar}/attestor-auth-request` → `{ authRequest: { data: { id,
  createdAt, expiresAt, hostWhitelist }, signature: 0x-hex } }`, Round 1A).
  The signed `data` (incl. timestamps) is passed through verbatim — the
  browser must NOT fabricate timestamps, since the signature covers them.
- **ZK proving runs the vendored stwo wasm** (`vendor/s2circuits.js` +
  `s2circuits_bg.wasm`, copied from the package's `resources/` — the
  published tarball ships only `lib/`, and the published `./stwo` entry is
  Node-only: `createRequire` + `fs` at module scope). Same circuit set as the
  Node client (`zkEngine: 'stwo'`), real chacha20/aes proof roundtrip proven
  in `attest.test.ts`.

Module surface (the Round-2 agent imports these):

- `strava.ts` — `buildAuthUrl`, `parseAuthCallback`, `exchangeCode`,
  `refreshAccessToken`, `getValidAccessToken` (auto-refresh, 60s slack),
  `fetchActivities` (Strava sends `access-control-allow-origin: *` — direct
  browser fetch verified 2026-08-07), `emptyAccountGuard`
  (`canInteract: false, reason: 'no-activities'` on an empty account),
  `localStorageTokenStore` (per-origin key `wf-strava-tokens`).
- `identity.ts` — `athleteIdentityFromExchange` → `{ name: "First Last",
  stravaId }` (the UI's dynamic username; `stravaHandle` left unset).
- `attest-browser.ts` — `attestStrava(accessToken)` → `{ claim, proof }`
  (identical to the Node client's `attestRequest` result; the notary's
  `normalizeArtifacts` accepts the transformProof shape — cross-checked in
  tests against the real notary module), `verifyClaimSignatures`,
  `proofToNotaryArtifacts` (maps onto the strip's `{ claim, claimSignatureHex,
  attestorAddress }` shape), `getOrCreateOwnerKey` (persisted random owner
  key).
- `stwo-browser.ts` — `makeStwoZkOperator` + `browserStwoOperators()`.

Service dependency (Round 1A, all on the sidecar `:8200`):
`POST /attestor-auth-request`, `POST /strava/exchange { code }`,
`POST /strava/refresh { refresh_token }`. OAuth env: `VITE_WF_STRAVA_CLIENT_ID`
(public id, default the demo app `270524`) and `VITE_WF_ATTESTOR_URL`
(default `ws://localhost:8001/ws`). The Strava app's redirect URI list must
include `<origin>/strava/callback`.

**Browser-bundle caveat (verified empirically 2026-08-07):** once a screen
imports `attest-browser`, `vite build` needs 4 resolve aliases — the
published attestor-core bundle statically imports Node-only chains that break
rolldown (koffi/re2 natives, `fs/promises`, and the `./stwo` createRequire
chain). Working set, validated in `/tmp/opencode/browser-test` (build + chunk
eval green): `koffi` → throw-stub, `re2` → throw-stub, `fs/promises` →
throw-stub, `@reclaimprotocol/zk-symmetric-crypto/gnark` → throw-stub,
`@reclaimprotocol/zk-symmetric-crypto/stwo` → `ui/src/lib/attest/stwo-browser.ts`.
This is a vite.config.ts change (owned by the Round-1B/2 strip agent) — see
STATUS.md Round 1C notes.

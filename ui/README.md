# ui — WitnessFitness demo frontend

React + Vite (browser DApp) for the demo: **Connect · Vault · Wagers · Streaks & Badges · Employer Panel**, under the dark "sealed envelope" aesthetic. Privacy is the product — the UI says it.

Run:

```bash
pnpm dev:ui            # copy-keys (ZK artifacts + deploy-output.json → public/) + vite on :5173
```

Modes (one flag, no rewrite):

| Mode | What runs | When to use |
|---|---|---|
| `fixture` (default) | In-memory demo client — offline, deterministic, no wallet/chain/sidecar needed | The rehearsed demo path |
| `live` (`?mode=live` or `VITE_WF_MODE=live`) | The **demo sidecar** on `:8200` (packages/api) does everything on-chain: fixture proof artifacts → notary collection (2-of-3) → contract submit → vault. The browser only does typed fetch calls. **No Lace wallet required.** | When the sidecar is up (start command below) |
| `wallet` (`?mode=wallet` or `VITE_WF_MODE=wallet`) | **Browser wallet (Lace / DApp Connector)** — the wallet only funds gas (DUST/NIGHT); the app identity is a random 32-byte holder secret (never derived from wallet keys, nothing linkable on-chain). Private state is password-encrypted (WebCrypto AES-GCM, PBKDF2) and exportable/importable so a user can back up and resume. | When a Midnight wallet extension is installed in the browser |

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

Limits: wallet-mode wagers stay demo-only (single browser identity — the
sidecar's two identities are the live-wager actors); live-mode wagers are REAL
(see below).

### Start the sidecar (live mode)

Built in `packages/api`; needs the devnet + 3 notary instances up first (full
start order + health checks: `docs/DEMO-PLAYBOOK.md`):

```bash
pnpm --filter @witnessfitness/api start:sidecar   # reads deploy-output.json at startup
curl http://127.0.0.1:8200/health                # { ok, ready, contractAddress, network }
```

The UI reads the contract address from the sidecar's `/health` (and the notary strip reads `deploy-output.json`, copied to `public/` at dev/build time) — so a contract redeploy needs **no UI change**.

## Demo script (~7 minutes) with fallback triggers

Every live step has a fixture-backed twin; switching modes mid-demo is one click in the header. **Rehearse both until switching is invisible.**

| Time | Beat | How | Fallback if broken |
|---|---|---|---|
| 0:00 | Pitch hook | "The chain is about to compare two workouts it can't see." | — |
| 0:15 | Connect — attest | Enter demo as Ava Reyes → "Connect Strava & attest workout" → watch the staged pipeline: *witnessing TLS → notarizing (2-of-3) → vaulting*. The "real crypto happening live" moment. | Live mode: the sidecar replays the fixture session and does the real notary+chain work — same UI, "replaying attested session" copy is built in. **Sidecar down → "demo service offline" notice with a one-click "Switch to demo mode →" link** (no script change). |
| 1:00 | Vault | Credential landed, sealed; hover the envelope → commitment on-chain. Chips are provable claims, never raw values. Live mode adds the txHash row. | Seeded vault data already present in demo mode. |
| 1:30 | Create wager | Fixture: the seeded "Evening walk" wager. **Live:** roster challenge (Ava/Milo, copyable challenge IDs A/B) or challenge-by-ID input; stake 10 NIGHT; deadline ~90 s with an on-screen countdown. | Fixture: pre-seeded wager. Live: if the sidecar is down → the mode toggle. |
| 2:30 | Sealed submissions | Submit your sealed workout (pick the 12.4 km credential) → envelope seals; Milo's envelope seals ~1.4 s later (auto). | Same in both modes (opponent submission auto-lands). |
| 3:00 | Settle + reveal | "Settle — reveal winner under seal". Beat 1: winner + pot. Beat 2: **"find the losing number"** — winner value shown, loser masked, room cannot guess. Beat 3: "athletes choose to disclose" — comparison appears with the honest framing: *the ledger never revealed it*. | Same path in both modes. |
| 4:00 | Streak + badge | Streaks tab: "Attest today → advance" (2→3), chain link seals 🔥. `mintBadge(1)` — Streak of 3 mints. | Same path; live mode goes through the sidecar (`/streak/advance`, `/badge/mint`). |
| 5:00 | proveBadge to mock employer | Employer Panel tab: run `proveBadge(1, verifier)` — transcript fills with on-chain receipts; streak data stays sealed (🔒 line). | Same path; live mode through the sidecar (`/badge/prove`). |
| 5:45 | Notary strip | Bottom strip: 3 keys (read from `deploy-output.json` — survives redeploys), live health, "threshold 2-of-3". | Strip always renders; live mode shows unreachable keys in red. |
| 6:15 | Business | B2B2C one-liner (docs/PITCH.md): employer wellness pays, platform never sees health data. | — |

**Rehearsal rule:** run the fixture path twice (once cold, once with the tab order scrambled), then once live. If any live step fails, the fallback is the header mode toggle — no script change.

## The client wrapper (integration contract)

All backend calls go through `src/lib/wf-client.ts` (`WfClient`) — fixture fallback is a flag, not a rewrite. Implementations:

- `src/lib/fixture-client.ts` — full demo story (offline, deterministic; smoke-tested in `fixture-client.test.ts`).
- `src/lib/live-client.ts` — delegates to the **demo sidecar** (`src/lib/chain.ts`), which owns every on-chain concern. **Wagers are LIVE (Phase C)**: `createWager`/`acceptWager`/`submitWorkout`/`settleWager`/`listWagers` hit the sidecar's `/wager/*` endpoints; stakes are real unshielded NIGHT (10 NIGHT default, base 10^12), the winner takes the pot plus a shielded WitnessFitness NFT, and the settle response's `disclosed` values feed the honest reveal. `submitWorkout(id, athlete)` — the second arg is the acting sidecar identity ('A' or 'B'); both athletes are driven from this screen. Fixture mode unchanged.
- `src/lib/chain.ts` — the sidecar delegation layer: `GET /health`, `POST /attest { artifacts }`, `POST /streak/advance { vaultKey }`, `POST /badge/mint { vaultKey, badgeId }`, `POST /badge/prove { badgeId }`, `GET /state`. Timeboxed (12 s) with a typed `SidecarOfflineError` so failures render as the "demo service offline — switch to demo mode" state. Wire values are parsed leniently (number or 0x-hex; epoch s or ms).
- `src/lib/deploy-info.ts` — notary strip registry facts from `public/deploy-output.json` (copied from `packages/contract/deploy-output.json` by copy-keys), with embedded fallback constants for offline/fixture tests.

### `/attest` artifacts payload

Live mode replays the embedded fixture artifacts (packages/client/fixtures shape) through the sidecar:

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
- **Attestation agent:** when Strava fixtures land, drop them into `packages/client/fixtures/` and copy them to `ui/src/domain/fixtures/` — live mode will replay them automatically.

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
├── domain/              # types + demo story + embedded fixture artifacts
├── lib/                 # wf-client (contract), fixture/live clients, chain (sidecar), deploy-info, notary-api, format
├── state/DemoStore.tsx  # single source of truth for all screens
├── components/          # Envelope, NotaryStrip, StatusLine, RevealSettle, bits
├── screens/             # Connect, Vault, Wagers, Streaks, Employer
└── styles.css           # the sealed-envelope design system
```

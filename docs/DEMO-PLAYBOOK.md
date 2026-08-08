# DEMO-PLAYBOOK.md — demo-morning checklist (WitnessFitness)

The demo is **live-only: two browsers, two wallets, two Strava accounts, real
crypto throughout.** No mocked data exists anywhere in the UI (fixture/demo
mode was removed 2026-08-07). The automated suites (177 tests) + the scripted
E2E are the regression net; the human two-browser pass below is the show.

One-liner for the top of the demo: **"prove the workout, hide the data."**

---

## 1. Stack overview (everything must be running)

| Service | Port | Role |
|---|---|---|
| Midnight node (devnet) | 9944 | chain |
| Indexer | 8088 | public data / contract state |
| Proof server | 6300 | ZK proofs |
| Attestor (Reclaim, self-hosted) | 8001 (ws) | TLS witness for live attestation |
| Notary signers ×3 | 8101/8102/8103 | independent verification + Schnorr signing |
| Stateless demo service (packages/api) | 8200 | `/attestor-auth-request` (signs the attestor auth request — private key stays server-side), `/strava/exchange` + `/strava/refresh` (client secret stays server-side), `/wager-openings` relay (two browsers exchange settlement openings, TTL 30 min), `/health`. Debug identity endpoints (attest/streak/badge/wager as sidecar athletes) remain for `?mode=live` maintainer use only. |
| Vite dev server | 5173 | the demo UI (default: wallet mode) |

**Browser-side requirements (per browser):** a Midnight wallet extension (Lace)
pointed at the local devnet with funded NIGHT/DUST, and a Strava account with
**at least one activity** (the app blocks interaction on empty accounts).

---

## 2. Demo-morning start order (exact commands)

From the repo root, in order:

```bash
# 1. Devnet (node + indexer + proof server)
pnpm devnet:up                      # waits for node+indexer healthy

# 2. Attestor (self-hosted Reclaim)
bash attestor/run.sh                # ws://localhost:8001/ws; ~10s to be ready

# 3. Notary signers (3 instances, 3 keys)
pnpm --filter @witnessfitness/notary start:instances   # ~10s

# 4. Stateless demo service
pnpm --filter @witnessfitness/api start:sidecar        # ~5-15s; logs to stdout

# 5. UI — default is WALLET mode (no query param needed)
pnpm dev:ui                         # http://localhost:5173
```

`?mode=live` remains available for maintainer debugging (the identity sidecar —
both athletes driven from one screen). **The demo itself uses two browsers in
wallet mode.**

### Two-browser demo walkthrough (the show)

1. **Browser 1** (e.g. your main profile): Lace = wallet seed ONE (restore the
   phrase below), devnet network. Open `http://localhost:5173` → Connect wallet
   → Authorize → **Connect Strava** → authorize your first account (redirect
   returns to `/strava/callback`, auto-exchanged) → **Attest workout** — the
   real TLS witness runs in the browser (stwo ZK proof), 2-of-3 notaries sign,
   the wallet signs the on-chain tx → a real vaulted credential (~15-25 s).
   Copy the **holder-binding challenge ID** from the Connect card.
2. **Browser 2** (a *different profile* — one Lace wallet per profile): Lace =
   wallet seed TWO. Same steps with the **second Strava account** (must have ≥1
   activity). Its own challenge ID.
3. **Wager:** Browser 1 → Wagers → Create → paste **Browser 2's challenge ID** →
   stake (10 NIGHT), deadline ~90 s → escrow tx. Browser 2 → Accept (escrows
   its stake) — accept and both submissions must happen **before the deadline**
   (contract-enforced; the UI locks the Seal buttons at the deadline).
4. **Both seal their submission** (each browser, its own credential — its
   opening is relayed to the service immediately).
5. **Settle** (either browser, after the countdown): the relay is polled until
   both openings arrive → both staged into the settling wallet's private state
   → settle tx → **reveal: winner + 2×stake pot + the shielded NFT** + the
   on-chain comparison (both values are published at settlement — they were
   sealed until then, never before). The loser's view shows a synthetic name
   (privacy by design).
6. **Guard demo (optional):** authorize a Strava account with zero activities →
   "no activities yet" notice, interactions disabled.

### Wallet setup — once per demo machine

1. Install Lace in **both profiles**, point both at the **local devnet** network.
2. Restore the demo wallets (genesis-mint — hold devnet tNIGHT; DUST registers
   in-wallet):
   - Browser 1 → seed ONE: `abandon … ×23 diesel` (last word `diesel`)
   - Browser 2 → seed TWO: `abandon … ×23 false`
   - (seed THREE → `kite`, spare)
   ⚠️ Devnet-only phrases — canonical BIP39 encodings of public test seeds;
   anyone can compute them. Never use for anything real.
3. Both browsers: first connect generates the holder secret; **"Back up private
   state"** (password) exports the encrypted payload; **"Restore"** resumes the
   same identity after reload (auto-resume prompt).

---

## 3. Health-check one-liners (run each, expect the noted output)

```bash
# node: expect HTTP 200 on /health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9944/health

# indexer: expect 405/200 (GraphQL endpoint answers)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8088/api/v3/graphql

# proof server: expect 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6300

# notaries: expect {notaryId, keyId} with x-coords 0x3862…/0x58da…/0x6b58…
curl -s http://127.0.0.1:8101/health && echo && curl -s http://127.0.0.1:8102/health && echo && curl -s http://127.0.0.1:8103/health && echo

# service: expect stateless:true, hasStrava:true, hasAttestorKey:true, contract cf80ad42…
curl -s http://127.0.0.1:8200/health

# stateless endpoints smoke:
curl -s -X POST http://127.0.0.1:8200/attestor-auth-request -H 'content-type: application/json' -d '{}'
curl -s -X POST http://127.0.0.1:8200/wager-openings -H 'content-type: application/json' -d '{"wagerId":"smoke","who":"A","value":"0x1","rand":"0x2"}'
curl -s http://127.0.0.1:8200/wager-openings/smoke

# attestor (WS — HTTP probe proves the port answers; a 404 on HTTP is expected)
curl -s -m 2 http://127.0.0.1:8001/ ; echo " (404 expected — WS server)"

# all-in-one status line:
for p in 9944 8088 6300 8101 8102 8103 8200; do printf '%s:%s ' $p $(curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:$p/); done; echo
```

Total wall time to a fully live stack: ~2–4 min. **Verify each step before
starting the next.** If a submission is rejected, check the node log for the
rejection reason (`docker logs node --tail 30 | grep -i reject`) — known causes
below.

---

## 4. Contract-state verification

```bash
# Registry vs running instances (admin identity from admin-secret.local):
pnpm --filter @witnessfitness/api exec tsx scripts/read-registry.ts
# Expect: registry x-coords == notary /pubkey x-coords (0x3862…/0x58da…/0x6b58…)

# deploy-output.json (contract facts):
cat packages/contract/deploy-output.json
#  contractAddress:  cf80ad421b2b85f6ca1b3c0ccfd140ae5f6fc0d5871426d7750df4d42944cbaf
#  adminSecret:      ABSENT by design — it lives in admin-secret.local
```

The UI reads the contract address from the service `/health` and the strip keys
from `public/deploy-output.json` (refreshed by `pnpm --filter ui run copy-keys`).
**A redeploy needs no UI change** — restart the service and re-run copy-keys.

---

## 5. Key backup checklist — CRITICAL, do the morning of the demo

Copy these files to a safe location **OUTSIDE the repo** (USB stick / password
manager / ~/Documents-backup). They are the entire trust anchor of the demo.

| File | What it is | Lost WITHOUT it |
|---|---|---|
| `packages/contract/admin-secret.local` | admin identity secret (one-line hex, mode 0600) | Registry **frozen**: cannot rotate/blacklist notaries. Any key mishap = full redeploy. |
| `packages/notary/.env.notary-1` | notary-1 key + config | Its on-chain slot is a key **nobody holds** → 2-of-3 becomes 1-of-3 → all attestations rejected → **total lockout, redeploy required**. |
| `packages/notary/.env.notary-2` | notary-2 key + config | Same as above for slot 1. |
| `packages/notary/.env.notary-3` | notary-3 key + config | Same as above for slot 2. |
| `attestor/.env` | attestor PRIVATE_KEY + config (the service reads it for `/attestor-auth-request`) | No live attestation — the pipeline's first hop is dead. |
| `packages/client/.env` | Strava app credentials + tokens (the service reads client_id/secret for `/strava/exchange`) | No browser OAuth — users can't authorize Strava. |

Backup command (example — destination is YOUR choice, outside the repo):

```bash
mkdir -p ~/witnessfitness-backup-$(date +%Y%m%d)
cp packages/contract/admin-secret.local ~/witnessfitness-backup-$(date +%Y%m%d)/
cp packages/notary/.env.notary-{1,2,3} ~/witnessfitness-backup-$(date +%Y%m%d)/
cp attestor/.env packages/client/.env ~/witnessfitness-backup-$(date +%Y%m%d)/
chmod 600 ~/witnessfitness-backup-$(date +%Y%m%d)/*
```

Never commit these files (`.gitignore` covers `.env*` + `admin-secret.local`).

---

## 6. Attestation freshness

- The contract's freshness window is **30 days** — an attestation's timestamp
  must be within 30 days of the on-chain call (regression-tested: 8-day-old
  accepted, 40-day-old rejected).
- **No fixtures, no one-shot nonces to manage**: every real attestation is a
  fresh TLS session with a fresh claim → a fresh on-chain credential. The
  one-shot rule now applies to *accounts*, not files: each Strava session
  produces one credential (nonce replay is the point).
- Strava OAuth tokens auto-refresh (the service's `/strava/refresh`); a
  re-authorization may be needed after long idle.

---

## 7. Known demo limits (say these honestly if asked)

- **Settlement needs both athletes' openings** — they travel through the
  service's `/wager-openings` relay (TTL 30 min); the settling browser stages
  both into its own private state and settles with its own wallet. This is a
  real commit-reveal: each party posts its opening when it seals its
  submission.
- **Both browsers are needed for a wager** — one wallet cannot be two parties
  (the contract escrows per holder binding).
- **Live attest takes ~15-25 s** (TLS witness + ZK proof + 2-of-3 notaries +
  proof server + inclusion). Say "the proof is being generated" out loud; do
  NOT double-click.
- **Live streak advance re-seals the current day at count 1** when advanced
  twice on the same day (contract anti-cheat: `count = d == lastDay+1 ? count+1
  : 1`). A count increment needs a credential dated the previous day.
- **Badge minting needs a real claim** (distance ≥ 10 km for badge 2, streak ≥
  3 for badge 1). The real Strava walks are 2.4-3.9 km — badge 2 stays honestly
  unmintable (the in-circuit denial IS the demo moment: "failed assert: Distance
  below threshold"); badge 1 needs 3 distinct-day advances.
- **The opponent's identity stays synthetic in your view** until disclosure —
  the contract only knows holder bindings; names appear only when athletes
  choose to disclose (and the same Strava account in both browsers shows the
  same athlete name — that's real).
- **Empty Strava accounts are blocked**: authorize an account with zero
  activities → the UI disables interactions with a clear notice.

---

## 8. Failure handling (no fallback — live only)

- **Service down** → UI shows "demo service offline"; restart per §2 (step 4).
- **Submission rejected** → `docker logs node --tail 30 | grep -i reject` and
  match against known causes:
  - `DustDoubleSpend` — stale wallet state after a node/service restart:
    restart the service (fresh wallet re-init) before retrying.
  - `InputsSignaturesLengthMismatch (192)` / `Transcript (104)` — node/indexer
    desync (fork): full chain reset + redeploy + rotate (see the incident
    recovery below).
- **Node stops producing blocks** (stall) → `docker restart node`, then restart
  the service; verify the block number advances
  (`curl -s -X POST http://127.0.0.1:9944 -H 'content-type: application/json'
  -d '{"jsonrpc":"2.0","id":1,"method":"chain_getHeader","params":[]}'`).
- **?mode=live (maintainer debug)**: the identity sidecar drives both athletes
  from one screen — useful for rehearsing the wager beat before the two-browser
  pass; it shares the same contract and service.

### Incident recovery: chain fork/corruption (2026-08-07, happened twice)

`root should be in the arena …` or a stalled block number with node/indexer
desync → the node and indexer disagree (fork). Reads keep working; **all
submits fail**. The compose file has **no volumes** — `docker compose down` +
`up` resets the chain to genesis.

1. `pnpm devnet:down && pnpm devnet:up`
2. `pnpm --filter @witnessfitness/contract run deploy` (redeploys + writes deploy-output.json; ~2-3 min)
3. `pnpm --filter @witnessfitness/contract run rotate-notaries` (re-registers the 3 instance keys; needs admin-secret.local)
4. Restart the service (`pnpm --filter @witnessfitness/api start:sidecar`) — it reads the new address at startup; `pnpm --filter ui run copy-keys`
5. Health checks (§3) + one live attest to confirm.

---

## 9. Rehearsal notes (2026-08-07 — automated + scripted, all real)

- **Automated suites: 177 tests green** (contract 40 — incl. real-token wager
  escrow/payout/NFT + 30-day freshness + parity; notary 26; api 49 — incl. the
  stateless endpoints; ui 62 — incl. the two-browser duel simulation with the
  relay + settle staging + the real stwo wasm prove/verify roundtrip).
- **Scripted E2E (Phase B, real money):** attest A (3545 m) + B (2426 m) →
  create → accept → submit ×2 → settle — winner A, pot 20 NIGHT on-chain
  (A 248→258, B 250→240), shielded NFT tokenType `91f59aa0…`, settle tx
  `fe0ca996…`.
- **Real live attest timings:** ~19-23 s per submit beat; read path ~10 ms.
- **Wire fixes validated live:** 4xx domain errors surface verbatim; 25 s client
  cap (12 s caused spurious timeouts); CORS on every service path; the
  offer-signing fix (`WalletFacade.signRecipe`) that made unshielded contract
  receives work at all.
- **Demo-day clicks (two-browser pass):** see §2 — the whole story is
  click-driven; pause on the masked-loser frame at the settle reveal ("find the
  losing number") before the disclosure beat.

---

## 10. Hook GIF capture instructions (human-run)

Capture the **settle reveal** — the 10-second promise of the product:

1. Run the full stack (§2) and either the two-browser pass or `?mode=live`
   (sidecar-driven — deterministic, one screen).
2. Get to a settle with both envelopes sealed; **record now** (OBS / GNOME
   Screen Recorder / `ffmpeg -f x11grab`):
   - Beat A (0-3 s): envelopes flip, "Winner — 20 NIGHT pot moves" with **zero
     numbers on screen**.
   - Beat B (3-6 s): "Show the room — winner only" → the distance appears on the
     winner's side, the loser stays masked. Freeze here — this is the hook frame.
   - Beat C (6-9 s): "Athletes choose to disclose" → the comparison appears with
     the honest line "the ledger never revealed the losing input".
3. Trim to ~8 s, end on the masked-loser freeze frame. 16:9, 1080p+.

---

## 11. Pitch materials

- `docs/PITCH.md` — 6-slide outline (slide 4 carries the "how it uses Midnight"
  speaker notes incl. the hybrid pot: public unshielded NIGHT + shielded NFT).
- One-liner for the top of the demo: **"prove the workout, hide the data."**

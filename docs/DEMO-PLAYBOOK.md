# DEMO-PLAYBOOK.md — demo-morning checklist (WitnessFitness)

The demo is **7 minutes, fixture-first, live-ready**. Fixture mode is the rehearsed
path and works with zero services; live mode needs the stack below. **Both paths
rehearsed end-to-end 2026-08-07** (acceptance #5) — see "Rehearsal notes" for
timings and what to watch.

---

## 1. Stack overview (what must be running for LIVE mode)

| Service | Port | Role |
|---|---|---|
| Midnight node (devnet) | 9944 | chain |
| Indexer | 8088 | public data / contract state |
| Proof server | 6300 | ZK proofs |
| Attestor (Reclaim, self-hosted) | 8001 (ws) | TLS witness for live attestation |
| Notary signers ×3 | 8101/8102/8103 | independent verification + Schnorr signing |
| Demo sidecar (packages/api) | 8200 | everything the UI needs: notary collection, contract submit, state |
| Vite dev server | 5173 | the demo UI |

Fixture mode needs **none** of these (offline, deterministic).

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

# 4. Demo sidecar
pnpm --filter @witnessfitness/api start:sidecar        # ~5-15s; logs to stdout

# 5. UI (fixture mode works immediately; live mode needs steps 1-4)
pnpm dev:ui                         # http://localhost:5173
```

### Browser-wallet mode (mode=wallet) — setup, once per demo machine

The browser wallet only funds gas (DUST for fees; identity is an app-level
random 32-byte holder secret — never wallet keys, nothing linkable on-chain).

1. Install a Midnight-compatible wallet extension (Lace) in the demo browser,
   point it at the **local devnet** network.
2. Restore the demo wallet (genesis-mint ONE — holds devnet tNIGHT; DUST
   registers in-wallet):
   `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon diesel`
   (seed TWO `…0002` → last word `false`; THREE `…0003` → `kite` — for a second
   wallet identity if the wager demo ever needs two browser parties.)
   ⚠️ Devnet-only phrases — they are the canonical BIP39 encoding of public
   test seeds; anyone can compute them. Never use for anything real.
3. Open `http://localhost:5173/?mode=wallet` → Connect → Authorize.
4. First connect generates + stores the holder secret; "Back up private state"
   (password) exports the encrypted payload; "Restore" re-imports it to resume
   the same identity on reload.
5. Verify: attest → vault shows a real on-chain credential (tx hash visible).
   Full health checks for the underlying stack: see steps 1-4 above.

### Fallback matrix (demo day)

| Beat | Primary | Fallback |
|---|---|---|
| Everything | `?mode=fixture` (offline, rehearsed) | — |
| Live attest → vault | `?mode=live` (sidecar) | `?mode=wallet` (Lace) or fixture |
| Wagers | **LIVE (Phase C)** — real unshielded NIGHT stakes (10/side), shielded WitnessFitness NFT to the winner, sealed submit → settle with disclosed comparison | fixture twin remains for the rehearsed path |
| Badges / proveBadge | live (sidecar or wallet) | fixture |

Total wall time to a fully live stack: ~2–4 min. **Verify each step with the
health checks below before starting the next.**

### Demo-day incident: devnet chain state corruption (2026-08-07)

The devnet node's ledger DB was found corrupt after the power outage:
new transactions are rejected with
`root should be in the arena ... not in storage arena` (runtime trap at
`get_transaction_cost` during validation). Reads keep working; **all submits fail**
(attest / streak-advance / badge-mint / badge-prove all affected).

- Restarting the node (`docker compose restart node`) does NOT fix it — the DB
  itself is damaged (arena rebuilt from the same bad DB).
- The compose file has **no volumes**: the chain state lives in the node
  container's writable layer. `docker compose down` + `up` **resets the chain to
  genesis** and destroys the deployed contract.
- **Recovery procedure (orchestrator + contract agent):**
  1. `pnpm devnet:down && pnpm devnet:up`
  2. `pnpm --filter @witnessfitness/contract run deploy` (redeploys + writes deploy-output.json; ~2–3 min)
  3. `pnpm --filter @witnessfitness/contract run rotate-notaries` (re-registers the 3 instance keys; needs admin-secret.local)
  4. Restart the sidecar (`pnpm --filter @witnessfitness/api start:sidecar`) — it reads the new address from deploy-output.json at startup
  5. Re-run the health checks + one live attest to confirm.
- **Fixture note:** failed submits never land, so fixtures are NOT consumed by
  failed attempts — but the sidecar's in-memory double-count guard marks them;
  restarting the sidecar clears it. After recovery, the fresh fixture
  (fixture-github-attestor-core-fresh-x-84m.json) is the primary demo attestation.

---

## 3. Health-check one-liners (run each, expect the noted output)

```bash
# node: expect HTTP 200 on /health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9944/health

# indexer: expect 405/200 (GraphQL endpoint answers)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8088/api/v3/graphql

# proof server: expect 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6300

# notaries: expect {notaryId, keyId} with the registered x-coords 0x3862…/0x58da…/0x6b58…
curl -s http://127.0.0.1:8101/health && echo && curl -s http://127.0.0.1:8102/health && echo && curl -s http://127.0.0.1:8103/health && echo

# sidecar: expect {"ok":true,"ready":true,"contractAddress":"876edade…"}
curl -s http://127.0.0.1:8200/health

# sidecar state (read path): vault/streaks/badges
curl -s http://127.0.0.1:8200/state

# attestor (WS — HTTP probe proves the port answers; a 404 on HTTP is expected)
curl -s -m 2 http://127.0.0.1:8001/ ; echo " (404 expected — WS server)"

# all-in-one status line:
for p in 9944 8088 6300 8101 8102 8103 8200; do printf '%s:%s ' $p $(curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:$p/); done; echo
```

---

## 4. Contract-state verification

```bash
# Registry vs running instances (admin identity from admin-secret.local):
pnpm --filter @witnessfitness/api exec tsx scripts/read-registry.ts
# Expect: registry x-coords == notary /pubkey x-coords (0x3862…/0x58da…/0x6b58…)

# deploy-output.json (contract facts):
cat packages/contract/deploy-output.json
#  contractAddress:       364a84dd0bc065d7ea25fd45d2072763a1477ee15011e3b5c6bf2c07d04a5ff3
#  notaryInstances:       3 entries with id/port/slot + publicKey
#  adminSecret:           ABSENT by design — it lives in admin-secret.local
```

The UI reads the contract address from the sidecar `/health` and the strip keys
from `public/deploy-output.json` (refreshed by `pnpm --filter ui run copy-keys`).
**A redeploy needs no UI change** — just restart the sidecar and re-run copy-keys.

---

## 5. Key backup checklist — CRITICAL, do the morning of the demo

Copy these files to a safe location **OUTSIDE the repo** (USB stick / password
manager / ~/Documents-backup). They are the entire trust anchor of the demo.

| File | What it is | Lost WITHOUT it |
|---|---|---|
| `packages/contract/admin-secret.local` | admin identity secret (one-line hex, mode 0600) | Registry is **frozen**: cannot rotate/blacklist notaries, cannot re-register after a redeploy-rotation. Contract still works for demo flows, but any key mishap = full redeploy. |
| `packages/notary/.env.notary-1` | notary-1 key + config | Its on-chain slot is a key **nobody holds** → that slot can never sign again → 2-of-3 becomes 1-of-3 → all attestations rejected → **total lockout, redeploy required**. |
| `packages/notary/.env.notary-2` | notary-2 key + config | Same as above for slot 1. |
| `packages/notary/.env.notary-3` | notary-3 key + config | Same as above for slot 2 (loss of any TWO = immediate lockout; loss of one still breaks 2-of-3). |
| `attestor/.env` | attestor PRIVATE_KEY (ETH-style) + config | Cannot run live attestation or replay fixture verification — the pipeline's first hop is dead. |
| `packages/client/.env` | Strava OAuth tokens (+ app credentials when landed) | Cannot do live Strava attestation or regenerate Strava fixtures. |

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

## 6. Fixture freshness

- The contract's attestation freshness window is **30 days** — fixtures generated
  within 30 days of the demo are accepted (regression-tested: 8-day-old accepted,
  40-day-old rejected).
- **Regenerate the Strava fixtures the morning of the demo anyway** (insurance,
  per AGENTS.md §8): each fixture is good for exactly ONE on-chain attestation
  (deterministic nonce → replay blocked).
  - `packages/client/.env` needs STRAVA_CLIENT_ID/SECRET (+ tokens via
    `pnpm dev:client auth`).
  - `pnpm dev:client fixtures 3` then copy the JSONs into
    `ui/src/domain/fixtures/` (they're embedded in the bundle).
- Embedded today (public-API + REAL Strava fixtures, offline-verified). **One-shot
  rule:** each fixture is good for exactly ONE on-chain attestation, and the
  sidecar's dedupe key is the claim identifier — deterministic per (URL+context),
  so two fixtures from the SAME attestation can never both attest. Every demo
  attestation therefore needs a DISTINCT attestation (regenerate = new claim).
  Current on-chain status on contract `f52b493b…`:
  - `fixture-activity-19643821526-3900m.json` — the showcase walk (3.90 km /
    2942 s); **CONSUMED (2026-08-07 Phase C E2E, tx `3c105361…`)**; log-003 in the UI.
  - `fixture-activity-19643821429-3545m.json` — 3.54 km / 3010 s; **FRESH — the
    demo's live attest** (log-001 in the UI).
  - `fixture-activity-19643822226-2426m.json` — 2.43 km / 1825 s; **FRESH spare**
    (log-002 — the opponent's number in the wager story).
  - `fixture-github-zk-fetch-reserve-x-0m.json` — named fallback (log-004;
    github stargazers count ≈ 84 m as "distance" — honest fallback only).
  - Regeneration: `pnpm --filter @witnessfitness/client exec tsx src/rehearse-fixtures.ts`
    (public API) or `pnpm dev:client fixtures 3` (real Strava — the demo-morning
    replacement, workout-sized metrics); copy the JSON into `ui/src/domain/fixtures/`
    and put it first in `ATTESTATION_LOG` (story.ts).

---

## 7. Known demo limits (say these honestly if asked)

- **Wagers are LIVE in sidecar mode (Phase C).** Both athletes are sidecar
  identities (A = seed ONE, B = seed TWO) with real vaulted Strava credentials
  (3545 m / 2426 m); stakes are real devnet NIGHT (10 per side, escrowed
  on-chain); the winner receives the pot + a shielded WitnessFitness NFT.
  The screen drives both athletes' submissions (two explicit seal buttons) and
  settles after the deadline + 60 s grace (countdown shown). The loser's value
  appears only on the athletes-choose-to-disclose beat. Fixture mode remains the
  rehearsed twin; wallet mode keeps wagers demo-only (single browser identity).
- **Live mode requires the sidecar** on :8200; a dead sidecar renders
  "demo service offline — switch to demo mode" with a one-click toggle.
- **Live attestation is one-shot per fixture AND per URL+context** (nonce replay
  protection — that's the point). After a successful live attest, run the
  streak/advance → badge beats on the same credential; don't re-attest with the
  same fixture.
- **Live submit beats are slow (9–23 s)**: notary fan-out + proof gen + inclusion
  + readback. The UI cap is 25 s; clicks feel "stuck" for a moment — say
  "the proof is being generated" out loud; do NOT double-click.
- **Live streak advance re-seals the current day at count 1** when you advance
  twice on the same day (contract: `count = d == lastDay+1 ? count+1 : 1` —
  one attestation per day is the anti-cheat). The 2→3 streak story with the 🔥
  chain is fixture-mode; live mode shows count 1 after the first advance.
- **Badge minting in live mode needs a workout claim** (distance ≥ 10 km for
  badge 2, streak ≥ 3 for badge 1). The real Strava walks are 2.4–3.9 km — badge
  2 stays honestly unmintable (the in-circuit denial IS the demo moment:
  "failed assert: Distance below threshold"); badge 1 becomes mintable only
  after 3 distinct-day advances. The demo script's badge beat is fixture-mode.
- **The sidecar tracks attested credentials in memory**: restarting it forgets
  them ("unknown credential — attest first"). Do attest → streak → badge in one
  sidecar session, or restart and re-attest.

---

## 8. Fallback trigger

- **One click, mid-demo:** the header mode toggle (or `http://localhost:5173/?mode=fixture`)
  switches fixture ↔ live. Fixture mode is a full twin of every live beat
  (identical screens; "demo mode" pill turns amber).
- Every live step failing → run the whole script in fixture mode: zero services,
  zero network, ~0 latency.
- If a fixture's nonce is consumed (409 "already attested"): restart the sidecar
  to clear its in-memory guard, or switch to the other embedded fixture.

---

## 9. Rehearsal notes (2026-08-07, Phase D + C — BOTH PATHS REHEARSED ✅)

Recorded from the actual runs — timings and beats that need care.

**Fixture-mode rehearsal (vitest suite + headless chromium) — REHEARSED:**
- Full story: enter demo → attest (1.4 s staged pipeline) → vault (instant) →
  accept wager → submit (envelope seals) → opponent auto-seals (1.4 s) → settle
  → 3-beat reveal → streak 2→3 → mintBadge(1) → proveBadge → employer panel.
  Total interactive time ≈ 90 s for the demo beats; 8/8 tests green, tsc clean,
  vite build 1.1 s, headless mounts both modes without errors.
- **Beat that needs care:** the settle reveal is click-driven through three
  phases (winner → "find the losing number" → athletes disclose). Pause 2–3 s on
  the masked-loser phase for the audience beat; don't rush to the disclosure.
- **Beat that needs care:** the opponent's envelope seals ~1.4 s after yours —
  do NOT click settle before it lands (the button only appears when both are in).

**Live-mode rehearsal (sidecar :8200 on the healthy chain f52b493b…) — REHEARSED:**
- Read path: connect 10 ms (contract from /health), vault 12 ms, streak 10 ms,
  badges 2, notary strip 3/3 up with the rotated keys. Instant and solid.
- **REAL STRAVA LIVE ATTEST (Phase C, 2026-08-07) — the showcase beat now runs on
  real workout data**: fixture-activity-19643821526-3900m.json (3.90 km / 2942 s)
  POSTed to /attest → **200 in 18.9 s**, vaultKey `0x50b5c4ac…eabc84`, txHash
  `3c1053617f63380011c824e692493f762d7dea3014a5434ac92069f35bbb0e31`, metrics
  [{metricId 1, distance 3900}, {metricId 2, moving_time 2942}] — REAL values,
  on-chain, sealed. /state shows the credential (3 vault entries).
- **streak/advance (real credential) → 200 in 21.7 s**: { streakCount 0x1,
  lastDay 0x50c0 }. Same-day advance re-seals at count 1 (contract anti-cheat —
  see §7). A count increment needs a credential dated the previous day.
- **badge/mint(2) → in-circuit DENIAL on real data**: "failed assert: Distance
  below threshold" — 3900 m < 10 000 m; the honest predicate, enforced on-chain.
- **badge/prove(1) → DENIED**: "not a badge holder" (no badge minted yet).
- Earlier github-fixture rehearsal (same session): attest 200 tx `e7fe84a6…`
  (84 m star count); recovery E2E tx `46513c65…`; streak/advance 200; badge
  predicates enforced in-circuit.
- **Wire fixes validated live:** 4xx domain errors surface verbatim (409
  double-count, 404 unknown credential, 400 assert); submit beats need the 25 s
  cap (12 s produced spurious timeouts — fixed 2026-08-07).
- **One-shot caveat observed in practice:** a second attest with a same-URL
  fixture → 409 "proof artifacts already attested (double-count)" (sidecar
  dedupe is per claim identifier, deterministic per URL+context). Distinct
  attestations only.

**Demo-day clicks for the live beat (what to press, in order):**
1. `http://localhost:5173/?mode=live` → header shows the live pill.
2. Connect → **Connect to demo service** (instant; session card shows the
   contract short address).
3. **Connect Strava & attest workout** → the staged pipeline runs (TLS →
   notarizing → chain) — the submit itself takes ~15–25 s; do not double-click.
   The attest uses log-001 = the **3.54 km Strava walk** (fresh on-chain;
   regenerated fixtures get promoted to log-001 by whoever regenerates them).
4. Vault tab → the new credential's envelope + txHash row.
5. Streaks tab → **Attest today → advance** (~22 s) → count reflects the chain.
6. Any badge/prove click shows the honest denial message (fixture mode for the
   badge story).
7. Notary strip shows 3/3 keys and the threshold line.

**Post-recovery live rehearsal (when a fresh fixture is embedded):**
```bash
REHEARSE=live pnpm --filter ui exec vitest run src/lib/rehearsal-live.test.ts
# expect: connect/vault/streak/badges/notaryStatus OK; attest → vaultKey+txHash;
# advanceStreak → streakCount (increments only with a previous-day credential;
# same-day advance re-seals at count 1 — see §7)
```

---

## 10. Hook GIF capture instructions (human-run)

Capture the **settle reveal** — it is the 10-second promise of the product:

1. Open `http://localhost:5173/?mode=fixture` (fixture mode = deterministic, no
   services needed for capture).
2. Pre-seed: enter as Ava → **attest once** (1.4 s) → Wagers tab → accept the
   seeded "Thursday tempo" wager → submit your workout → wait for both envelopes
   sealed (≈2 s) → click **Settle**.
3. **Record now** (OBS / GNOME Screen Recorder / `ffmpeg -f x11grab`):
   - Beat A (0–3 s): envelopes flip, "Winner: Ava Reyes — 100 tNIGHT pot moves"
     appears with **zero numbers on screen**.
   - Beat B (3–6 s): "Show the room — winner only" → 12.4 km appears on the
     winner's side, the loser stays masked. Freeze here — this is the hook frame.
   - Beat C (6–9 s): "Athletes choose to disclose" → the comparison appears with
     the honest line "the ledger never revealed the losing input".
4. Trim to ~8 s, end on the masked-loser freeze frame. 16:9, 1080p+.

---

## 11. Pitch materials

- `docs/PITCH.md` — 6-slide outline (slide 4 now carries the "how it uses
  Midnight" speaker notes; see the file).
- One-liner for the top of the demo: **"prove the workout, hide the data."**

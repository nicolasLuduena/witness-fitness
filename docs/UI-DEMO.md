# UI-DEMO.md — frontend, demo script, pitch (UI/demo agent's file)

You own `ui/` and the demo/pitch materials. The contract, notary, and attestation agents produce the moving parts; you make the room feel it. Demo-first: reliability and a rehearsed fallback beat feature count. For wallet/connection flows, mirror the reference app at `/home/batman/Documents/txpipe-shop/midnight-reference-app` (wallet SDK usage, provider wiring).

## 1. UI scope (`ui/`, React + Vite, pnpm workspace)

Dark "sealed envelope" aesthetic — the product is privacy, make the UI say it.

**Screens:**
1. **Connect** — "Connect Strava" (OAuth button, then the zk-fetch attestation runs; show the attestor step live with a status line: `witnessing TLS session → proof generated → notarizing`). This is the "real crypto happening live" moment.
2. **Vault** — the user's sealed credentials (list of commitments, timestamps, metric chips like "distance ≥ 5 km" — show what's *provable*, never the raw values).
3. **Wagers** — create (choose opponent, metric, stake, deadline) / join / open wagers. Show the sealed submissions as envelope glyphs; on settle, reveal animation: the **comparison** appears ("Winner: Athlete A — 12.4 km vs 8.1 km"), pot moves, then... *the values themselves are the one thing revealed to the winner; the room screen shows only the outcome.* Design the reveal honestly: the ledger never reveals non-winning inputs; the demo screen may show the comparison because the athletes choose to reveal it (have the UI expose "athlete chose to disclose result" clearly).
4. **Streaks & Badges** — sealed streak chain (day markers, all sealed); `mintBadge`; and the showpiece: **`proveBadge` to a mock employer panel** — a third-party screen that verifies "Athlete has badge: 30-day streak" and shows the verification proof, while the streak data stays sealed.
5. **Notary status strip** — always visible: 3 notary keys, green/red per signature counted ("2/3 signatures verified") — this makes the 2-of-3 trust model visible in 3 seconds.

**Demo mechanics to visualize:**
- Sealed submissions as envelope glyphs that are *provably unreadable* (hover shows "commitment on-chain: 0x…", never a value).
- The "challenge the room" beat: after settlement, host asks the audience to guess the losing value — nobody can.

**Live stack vs fixture mode (important — the UI is NOT mocked):**

- The UI **connects to real wallets** in both modes: wallet SDK integration mirroring the reference app (HD wallet, shielded/dust/unshielded roles, provider stack from `packages/contract/src/providers.ts`). Every contract interaction is a real signed transaction submitted to the local devnet — users see real wallet connect, real proofs, real ledger state. Wagers settle on-chain; badges exist in contract state.
- **Fixture mode swaps only the attestation source:** instead of a live zk-fetch session against Strava, the app loads pre-generated proof artifacts from `packages/client/fixtures/` and pushes them through the *identical* pipeline (notary signers → signatures → contract tx). The UI shows a "replaying attested session" badge. Wallet, contract, and ledger behavior are identical.
- Implementation rule: one client wrapper (`src/lib/backend.ts`) with a `USE_FIXTURES` flag — never two code paths, never fake screens.
- The only intentionally non-live element: the **mock employer panel** in the `proveBadge` beat — that's a second wallet (a "verifier" identity) verifying against the real contract, not a scripted screenshot.

## 2. Demo script (target ~7 minutes, with fallback triggers)

| Time | Beat | Fallback if broken |
|---|---|---|
| 0:00 | Pitch hook (10s): "The chain is about to compare two workouts it can't see." | — |
| 0:15 | Connect screen → live zk-fetch attestation vs Strava (real OAuth athlete) | Replay fixture proof through the same pipeline (identical UI, "replaying attested session" badge) |
| 1:00 | Vault: credential appears, sealed | — |
| 1:30 | Create wager (Athlete A vs B, distance, stake, deadline) | Pre-seeded wager |
| 2:30 | Both submissions land (envelopes seal on-screen) | Fixture submissions |
| 3:00 | Deadline → settle → reveal: winner + pot; **"find the losing number" challenge** | Pre-computed settle |
| 4:00 | Streak chain advances (sealed) → badge mints | Fixture streak |
| 5:00 | **proveBadge to mock employer** — third-party verify screen | Same, fixture-backed |
| 5:45 | Notary strip: "any 2 of 3 must collude to fake this" | — |
| 6:15 | Business slide (B2B2C) + architecture one-liner | — |

**Fallback rule:** every live step has a fixture-backed twin; rehearse both paths until switching is invisible.

## 3. Pitch outline (slides, ~6)

1. **Hook** — the sealed wager moment (video/gif from rehearsal).
2. **Problem** — fitness-economy apps died from bots (STEPN/Sweatcoin); health data is the most sensitive data; Strava shows everything.
3. **Solution** — WitnessFitness: provable workouts (attested, anti-bot) + private data (ZK) + fun (wagers, streaks, badges).
4. **Architecture (1 slide, honest)** — real API → attestor (Reclaim, self-hosted) → 2-of-3 notary signers → Midnight contract verifies Schnorr + predicates; trust model stated plainly (oracle-style anchor, threshold mitigates).
5. **Business** — B2B2C: employer wellness pays (per-employee; platform never sees health data = removes liability), consumer mechanics are the flywheel; attestation backends pluggable (Reclaim today, TEEs/MPC-TLS later) — the moat story.
6. **Roadmap** — fixture→testnet→multi-vertical (rent, insurance, payroll reuse the same credential vault).

## 4. Integration contracts (what you depend on)

- Contract ABI + entrypoint list: from the contract agent (workspace README).
- Wallet SDK + provider stack: mirror `/home/batman/Documents/txpipe-shop/midnight-reference-app` (`packages/contract/src/providers.ts`, wallet usage).
- `POST /attestate` on 3 notary instances: from the notary agent (`NOTARY.md` §4).
- zk-fetch attestation trigger: from the notary/client glue (`NOTARY.md` §5).
- Keep every backend call behind the single `src/lib/backend.ts` wrapper so fixture fallback is a flag, not a rewrite.

## 5. Definition of done

- All 5 screens run against the live stack (or fixture mode).
- 7-minute script rehearsed twice: once live, once fallback.
- Pitch deck drafted; hook gif captured.

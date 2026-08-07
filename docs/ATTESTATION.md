# ATTESTATION.md — self-hosted Reclaim stack + Strava (attestation agent's file)

You own `attestor/`, `client/`, and the fixture proofs. Your output feeds the notary signer agent. Midnight skills aren't needed here — this is the real-world data side.

## 1. Goal

Produce, from a **real Strava API interaction**, the artifacts the notary signer verifies:
`(redacted-request, redacted-response, zkproof)` + the attestor's signed claim. Plus: 3+ saved fixture proofs for tests and demo fallback.

## 2. Self-hosted attestor (Reclaim)

- Repo: `github.com/reclaimprotocol/attestor-core` (TypeScript, AGPL). npm: `@reclaimprotocol/attestor-core@5.0.8` (use `latest`).
- **Local run (per their docs `docs/run-server.md`):** clone → `.env` with at least `PRIVATE_KEY` (hex; see `.env.sample`) → `npm run start:tsc` → server on **port 8001**, WebSocket endpoint `wss://localhost:8001/ws`.
- Docker option: their `docker-compose.yaml` / `attestor.dockerfile` — either is fine; prefer whichever runs fastest in your environment.
- Optional auth: `createAuthRequest` with `hostWhitelist: ['www.strava.com']` — recommended so the attestor only tunnels whitelisted hosts (their `AUTHENTICATION_PUBLIC_KEY` env + signed requests pattern, per `docs/run-server.md`).
- Optional TOPRF (threshold OPRF to hide sensitive fields): **skip** unless time permits — it is not required for the demo.
- For Node-side ZK proof generation/verification: run `npm run download:zk-files` in the workspace installing the packages.

## 3. Build-start verification tasks (do these FIRST, report findings to the notary agent)

1. **Determine the attestor's `PRIVATE_KEY` signature scheme** (likely ECDSA/secp256k1 — confirm from source: `src/` key handling + `.env.sample`). The notary agent needs to know how claim signatures are encoded.
2. **zk-fetch custom-attestor wiring**: confirm the exact way to point `@reclaimprotocol/zk-fetch@1.1.0` at `wss://localhost:8001/ws` (their docs: "just replace the official Reclaim attestor URL with your own" — find the config field/param).
3. **Claim output shape**: generate one proof against a public endpoint (any API that returns JSON; use Strava if the OAuth app is ready) and dump the artifact structure. Document it for the notary agent (`docs of record`: keep a `fixtures/artifact-schema.md`).

## 4. Strava integration

- Create a dev app at strava.com/developers (free). You need: client ID, client secret, and an OAuth access token for a test athlete (authorization code flow, scope `read,activity:read_all`).
- Target endpoint: `GET https://www.strava.com/api/v3/athlete/activities?per_page=5`
- Fields we care about: `id`, `distance` (meters), `moving_time` (seconds), `start_date`.
- Rate limits: ~100 requests/15min, 1000/day (free tier) — plenty for the demo; be gentle anyway.
- The attestor flow happens against `www.strava.com` (or the API host). If Strava's TLS fingerprinting or bot protection blocks the Reclaim TLS client (unlikely for a pure API endpoint), report immediately — do NOT silently swap to a mock.

## 5. Fixture proofs (critical for reliability)

- **Generate ≥3 fixture proofs** from distinct real Strava activities (different distances — make the wager demo interesting, e.g. 5 km vs 10 km).
- Save the full artifact set in `client/fixtures/` as versioned JSON (request, response, proof, claim, plus metadata: athlete id, distance, timestamp).
- These are used for: (a) notary agent's tests, (b) demo fallback if a live session is flaky, (c) E2E test before the demo.
- Rehearse the fallback path: proving the fixture artifacts are still cryptographically valid when replayed (the proof must re-verify offline — confirm this works during Day 1 PM).

## 6. Fallback chain (decided)

1. Live zk-fetch session against Strava (primary).
2. Fixture proofs replayed through the same pipeline (identical crypto path).
3. If Strava itself is unreachable at demo time and no fixtures were possible: last resort is a real public JSON API (any) — never a fabricated "mock bank" style endpoint.

## 7. Definition of done (attestation)

- Attestor runs locally; zk-fetch client produces a verified proof from a real Strava call.
- ≥3 fixture proofs saved and re-verifiable offline.
- Artifact schema documented for the notary agent.
- Two unknown verification tasks (§3) answered and communicated.

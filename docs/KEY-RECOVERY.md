# KEY-RECOVERY.md — recreate keys from scratch (dev mode)

Devnet-only, demo-first. All paths verified against the scripts that read
them. Never paste real values into git — this doc describes contents only.

## Secret inventory

| File | Contents | Written by | Read by |
|---|---|---|---|
| `packages/contract/admin-secret.local` | One-line 32-byte hex (64 hex chars), mode 0600, gitignored | `scripts/deploy.ts:80` (from `WF_ADMIN_SECRET` or the demo default `00…a1`) | `scripts/rotate-notaries.ts:48`, `packages/api/scripts/e2e-attest.ts:55` |
| `packages/notary/.env.notary-{1,2,3}` | `NOTARY_KEY` (32-byte hex, 64 hex chars — validated in `src/config.ts:35`), `NOTARY_ID`, `PORT` (8101–8103), `ATTESTOR_URL`, `CONTRACT_ADDRESS`, node/indexer/proof-server URLs | You (`openssl rand -hex 32`) | Notary server via `NOTARY_ENV_FILE=.env.notary-$i` (`start:instances`) |
| `attestor/.env` | `PRIVATE_KEY` (ETH secp256k1, `0x`-prefixed 32-byte hex), `HOST`/`PORT`, `AUTHENTICATION_PUBLIC_KEY`, `DISABLE_BGP_CHECKS=1` | You | `attestor/run.sh` |
| `packages/client/.env` | Strava app `STRAVA_CLIENT_ID`/`SECRET`/`REDIRECT_URI` (from strava.com/developers — the app is registered, credentials just aren't on this machine yet), `STRAVA_*_TOKEN` (auto-populated by `tsx src/index.ts auth`), attestor URL/key, `OWNER_PRIVATE_KEY` | You + the auth flow | `packages/client/src/attest.ts` |

`deploy-output.json` is **not** a secret (committed): contract address +
notary public keys. It feeds `rotate-notaries.ts`, the sidecar, and the UI's
notary strip.

## Admin secret

- **Purpose:** pins the contract's admin identity (`deriveAdminBinding`,
  `stride.compact:50`); `registerNotary` / `rotateNotary` / `blacklistNotary`
  require it (`isAdmin`).
- **Loss impact:** the registry is **frozen forever**. Recovery = deploy a
  fresh contract (new address; update `deploy-output.json`, notary `.env`
  `CONTRACT_ADDRESS`, UI `copy-keys`).
- **Regeneration:** `openssl rand -hex 32` → `WF_ADMIN_SECRET=<hex> pnpm --filter @witnessfitness/contract run deploy` — the deploy script writes `admin-secret.local` (confirmed `deploy.ts:80–81`) and registers the demo notary keys.

## Notary keys

Generate 3 distinct keys (each 64 hex chars — `openssl rand -hex 32` fits),
one per `.env.notary-{1,2,3}` (`NOTARY_KEY`, `NOTARY_ID`, `PORT`), then:

```bash
pnpm --filter @witnessfitness/notary start:instances   # restart, ports 8101–8103
pnpm --filter @witnessfitness/contract run rotate-notaries   # fetches /pubkey from
  # 8101–8103, rotates slots 0–2 as admin, rewrites deploy-output.json
# verify on-chain (registry x-coords must equal the instances' /pubkey x-coords):
pnpm --filter @witnessfitness/api exec tsx scripts/read-registry.ts
```

Slot order matters: `NotaryClient` maps signatures to registry slots **by URL
order** (`packages/api/src/index.ts:139`), so instance i must stay slot i.

## Full from-scratch sequence (fresh machine, devnet only)

```bash
pnpm install
pnpm devnet:up                                  # node 9944, indexer 8088, proof server 6300
# 1. Attestor: clone attestor-core, npm install, write attestor/.env (PRIVATE_KEY etc.)
pnpm dev:attestor                               # ws://localhost:8001/ws
# 2. Notaries: 3 × `openssl rand -hex 32` into .env.notary-{1,2,3}
pnpm --filter @witnessfitness/notary start:instances   # curl :8101/health → ok
# 3. Deploy (writes admin-secret.local + deploy-output.json; demo keys registered)
pnpm --filter @witnessfitness/contract run deploy
# 4. Register the real instances (deploy only registered demo keys)
pnpm --filter @witnessfitness/contract run rotate-notaries
# 5. Verify: registry == instance keys (read-registry), then smoke
pnpm --filter @witnessfitness/api run e2e:attest # fixture → 2-of-3 → on-chain vault
pnpm --filter @witnessfitness/api start:sidecar  # :8200 — `curl http://127.0.0.1:8200/health`
pnpm dev:ui                                     # http://localhost:5173/?mode=live
# 6. Strava (closes the fixture gate): paste client ID/secret into packages/client/.env
pnpm --filter @witnessfitness/client exec tsx src/index.ts auth    # click Authorize
pnpm --filter @witnessfitness/client exec tsx src/index.ts fixtures 3
```

## Backup checklist (the 4 files)

1. **`admin-secret.local`** — lose it → registry frozen; redeploy (new
   address, ripple to notary `.env`/UI).
2. **`.env.notary-{1,2,3}`** — lose one → that instance can't sign; rotate
   that slot with a fresh key. Lose all → nothing ever verifies; redeploy.
3. **`attestor/.env`** — lose it → attestor won't start; a new key changes
   the signer address (nothing to re-register — notaries don't pin it), but
   live Strava proofs must be regenerated.
4. **`packages/client/.env`** — lose it → Strava flow blocked; the Client
   ID/Secret are recoverable from the Strava dashboard, then re-run `auth`.

**Golden rule:** prefer *rotating* over redeploying — 2-of-3 keeps working
through a lost key, while a redeploy changes the address everywhere.

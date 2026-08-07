# Self-hosted Reclaim attestor

This directory runs the WitnessFitness attestor: Reclaim's
`@reclaimprotocol/attestor-core` (self-hosted, port 8001), the witness server
that intermediates the TLS session with Strava and produces the ZK proof +
signed claim.

## Setup (owned by the attestation agent — docs/ATTESTATION.md)

1. Clone `github.com/reclaimprotocol/attestor-core` into `./attestor-core/`:
   `git clone --depth 1 https://github.com/reclaimprotocol/attestor-core.git`
2. `cd attestor-core && npm install` (their `prepare` builds the lib).
3. Copy `.env.sample` to `.env` (this directory) and set:
   - `PRIVATE_KEY` — ETH (secp256k1) private key, hex `0x`-prefixed, 32 bytes
     (generate: `node -e "console.log('0x'+require('crypto').randomBytes(32).toString('hex'))"`)
   - `AUTHENTICATION_PUBLIC_KEY` — compressed secp256k1 public key derived from
     `PRIVATE_KEY` (enables signed `createAuthRequest` auth; hostWhitelist)
   - `DISABLE_BGP_CHECKS=1` — the RIPE BGP listener is flaky and can crash the
     server; disabled for local testing
4. Start: `bash run.sh` (prefers the source clone; docker compose is the
   fallback).
5. Server listens on `ws://localhost:8001/ws` — **plain WS locally**, not
   `wss://` (TLS termination is a reverse-proxy concern in production; the
   docs' `wss://<domain>/ws` assumes that proxy).

## Verified facts (2026-08-06, attestor-core source clone)

- `PRIVATE_KEY` scheme: **ETH/secp256k1 ECDSA only**
  (`src/utils/signatures/eth.ts`; `SERVICE_SIGNATURE_TYPE_ETH` is the only
  registered type). Claim signatures are EIP-191 personal-sign digests, 65
  bytes r‖s‖v, signer identified by ETH address (`signatures.attestorAddress`).
- Their start script is `npm run start` (docs say `start:tsc`; same
  `run:tsc` runner — doc drift only).
- Auth is enforced when `AUTHENTICATION_PUBLIC_KEY` is set: unauthenticated
  connections get `ERROR_AUTHENTICATION_FAILED`.
- TLS path to `www.strava.com` works from this attestor (strava returns real
  HTTP responses; a no-token request returns 401 as expected).

## Secrets

`.env` only; never commit it. `PRIVATE_KEY` must stay out of git.

## Day-1 verification findings

Detailed findings (signature scheme + zk-fetch wiring) are recorded in
`packages/client/fixtures/artifact-schema.md` and `STATUS.md`.

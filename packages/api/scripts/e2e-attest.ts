// LIVE E2E (timeboxed, 5 min): fixture proof → 3 running notary instances →
// verifyAttestation on the DEPLOYED devnet contract → vaulted credential.
//   pnpm --filter @witnessfitness/api run e2e:attest
// Requires: devnet up, 3 notary instances running (8101-8103), contract
// deployed + registry rotated to the running instances (deploy-output.json).
// Fixture: set FIXTURE_PATH to a fixture whose nonce is NOT yet consumed
// on-chain (each fixture nonce is single-use — the default github fixture may
// already be consumed by a previous run/smoke; Strava fixtures are the fresh
// source once the OAuth step lands).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { configureProviders } from "@witnessfitness/contract/providers";
import { buildWallet, registerForDustGeneration } from "@witnessfitness/contract/wallet";
import { pureCircuits } from "@witnessfitness/contract";
import { NotaryClient, StrideContract, toHex } from "../src/index.js";

const INDEXER = process.env.INDEXER_URL ?? "http://127.0.0.1:8088/api/v3/graphql";
const INDEXER_WS = process.env.INDEXER_WS_URL ?? "ws://127.0.0.1:8088/api/v3/graphql/ws";
const NODE = process.env.NODE_URL ?? "http://127.0.0.1:9944";
const PROOF_SERVER = process.env.PROOF_SERVER_URL ?? "http://127.0.0.1:6300";
const GENESIS_MINT_WALLET_SEED =
  process.env.GENESIS_MINT_WALLET_SEED ??
  "0000000000000000000000000000000000000000000000000000000000000001";
const NOTARY_URLS = ["http://127.0.0.1:8101", "http://127.0.0.1:8102", "http://127.0.0.1:8103"];
const FIXTURE_PATH =
  process.env.FIXTURE_PATH ??
  new URL("../../client/fixtures/fixture-github-attestor-core-x-0m.json", import.meta.url);

const main = async () => {
  const output = JSON.parse(
    readFileSync(new URL("../../contract/deploy-output.json", import.meta.url), "utf-8"),
  );
  const contractAddress = output.contractAddress as string;
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));

  const notary = new NotaryClient(NOTARY_URLS);
  console.log("[e2e] collecting notary signatures...");
  const attestation = await notary.attestate(fixture);
  console.log(
    `[e2e] ${attestation.notaryIds.length}/3 signed (${attestation.notaryIds.join(", ")}) source=${attestation.metricSource}`,
  );

  console.log("[e2e] building wallet from genesis seed...");
  const walletCtx = await buildWallet(
    { indexer: INDEXER, indexerWS: INDEXER_WS, node: NODE, proofServer: PROOF_SERVER },
    GENESIS_MINT_WALLET_SEED,
  );
  await registerForDustGeneration(walletCtx.wallet, walletCtx.unshieldedKeystore);
  const providers = await configureProviders(
    walletCtx,
    { indexer: INDEXER, indexerWS: INDEXER_WS, proofServer: PROOF_SERVER },
    "stride",
  );

  console.log("[e2e] joining contract", contractAddress);
  const holderSecret = randomBytes(32);
  const adminSecret = Buffer.from(
    readFileSync(new URL("../../contract/admin-secret.local", import.meta.url), "utf-8").trim(),
    "hex",
  );
  const contract = await StrideContract.join(
    providers,
    contractAddress,
    "e2e-attest",
    StrideContract.freshPrivateState(adminSecret, holderSecret),
  );

  const commitRand = randomBytes(32);
  console.log("[e2e] submitting verifyAttestation...");
  const tx = await contract.verifyAttestationWith(attestation, holderSecret, commitRand);
  // api wrapper's ReturnType resolves the txCtx overload (CallResultPublic has
  // no txHash); runtime shape is FinalizedCallTxData -> public.txHash.
  const txHash = (tx as { public?: { txHash?: string } }).public?.txHash;
  console.log("[e2e] tx submitted:", txHash ?? tx);

  const state = await contract.readState();
  const vaultKey = pureCircuits.computeVaultKey(attestation.assertion, commitRand);
  console.log("[e2e] vault contains credential:", state.vault.member(vaultKey));
  console.log(
    "[e2e] done. vaultKey:",
    toHex(vaultKey).slice(0, 32) + "...",
    "| holder binding entry:",
    state.vault.member(vaultKey) ? "yes" : "no",
  );
  process.exit(0);
};

main().catch((error) => {
  console.error("[e2e] FAILED:", error);
  process.exitCode = 1;
});

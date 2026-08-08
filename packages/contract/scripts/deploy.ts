// Deploy the stride contract to the local devnet and bootstrap admin + notaries.
//   pnpm build        (full ZK key generation — required before deploy)
//   pnpm run deploy   (NOT `pnpm deploy` — collides with a pnpm builtin)
// Requires devnet: pnpm devnet:up (node 9944, indexer 8088, proof server 6300).
import { writeFileSync } from "node:fs";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { randomBytes } from "node:crypto";
import { firstValueFrom, timeout } from "rxjs";
import {
  CompactCompiledContract,
  createPrivateState,
  type PrivateState,
  type StrideContractType,
} from "../src/index.js";
import { buildWallet, registerForDustGeneration } from "../src/wallet.js";
import { configureProviders } from "../src/providers.js";
import { derivePublicKey } from "../src/offchain.js";

const INDEXER = process.env.INDEXER_URL ?? "http://127.0.0.1:8088/api/v3/graphql";
const INDEXER_WS = process.env.INDEXER_WS_URL ?? "ws://127.0.0.1:8088/api/v3/graphql/ws";
const NODE = process.env.NODE_URL ?? "http://127.0.0.1:9944";
const PROOF_SERVER = process.env.PROOF_SERVER_URL ?? "http://127.0.0.1:6300";
const GENESIS_MINT_WALLET_SEED =
  process.env.GENESIS_MINT_WALLET_SEED ??
  "0000000000000000000000000000000000000000000000000000000000000001";
const PRIVATE_STATE_ID = "stride-deploy";
const ADMIN_SECRET = process.env.WF_ADMIN_SECRET ?? "00".repeat(31) + "a1";
// Demo notary keys (3 fixed scalars — replace in production).
const NOTARY_SKS = [0x11111111n, 0x22222222n, 0x33333333n];

const demoPrivateState = (): PrivateState =>
  createPrivateState(Buffer.from(ADMIN_SECRET, "hex"), randomBytes(32));

const main = async () => {
  console.log("[deploy] building wallet from genesis seed...");
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

  console.log("[deploy] deploying stride contract...");
  const deployed = await deployContract<StrideContractType>(providers, {
    compiledContract: CompactCompiledContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: demoPrivateState(),
  });
  const contractAddress = deployed.deployTxData.public.contractAddress;
  console.log("[deploy] contract address:", contractAddress);

  console.log("[deploy] calling registerAdmin...");
  await deployed.callTx.registerAdmin();
  for (let i = 0; i < NOTARY_SKS.length; i += 1) {
    console.log(`[deploy] calling registerNotary(${i})...`);
    await deployed.callTx.registerNotary(derivePublicKey(NOTARY_SKS[i]), BigInt(i));
  }

  const state$ = await providers.publicDataProvider.contractStateObservable(contractAddress, {
    type: "latest",
  });
  await firstValueFrom(state$.pipe(timeout({ first: 30_000 })));
  console.log("[deploy] latest state readable; verifying on-chain registry...");

  const output = {
    contractAddress,
    notaryPublicKeys: NOTARY_SKS.map((sk) => derivePublicKey(sk)),
    notarySeeds: NOTARY_SKS.map((sk) => "0x" + sk.toString(16)),
    deployedAt: new Date().toISOString(),
  };
  // Admin secret lives OUT of deploy-output.json (which is committed); only
  // admin-secret.local (gitignored) carries it. Format: plain hex, one line.
  const adminSecretPath = new URL("../admin-secret.local", import.meta.url);
  writeFileSync(adminSecretPath, `${ADMIN_SECRET}\n`, { mode: 0o600 });
  const toJson = (value: unknown): string =>
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? "0x" + v.toString(16) : v), 2);
  writeFileSync(new URL("../deploy-output.json", import.meta.url), toJson(output));
  console.log("[deploy] done:", toJson(output));
  console.log(`[deploy] admin secret written to ${adminSecretPath.pathname} (gitignored)`);
  process.exit(0);
};

main().catch((e) => {
  console.error("[deploy] FAILED:", e);
  process.exitCode = 1;
});

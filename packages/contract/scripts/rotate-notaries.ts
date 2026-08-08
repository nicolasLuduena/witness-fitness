// Rotate the deployed contract's notary registry to the 3 RUNNING notary
// instances' public keys (fetched from their /pubkey endpoints). Admin
// identity comes from admin-secret.local (gitignored; written by deploy.ts).
//   pnpm --filter @witnessfitness/contract run rotate-notaries
// Requires devnet up + 3 notary instances running (ports 8101-8103).
import { writeFileSync, readFileSync } from "node:fs";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
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

const INDEXER = process.env.INDEXER_URL ?? "http://127.0.0.1:8088/api/v3/graphql";
const INDEXER_WS = process.env.INDEXER_WS_URL ?? "ws://127.0.0.1:8088/api/v3/graphql/ws";
const NODE = process.env.NODE_URL ?? "http://127.0.0.1:9944";
const PROOF_SERVER = process.env.PROOF_SERVER_URL ?? "http://127.0.0.1:6300";
const GENESIS_MINT_WALLET_SEED =
  process.env.GENESIS_MINT_WALLET_SEED ??
  "0000000000000000000000000000000000000000000000000000000000000001";
const PRIVATE_STATE_ID = "stride-deploy";
const NOTARY_BASE_PORT = Number(process.env.NOTARY_BASE_PORT ?? 8101);
const NOTARY_COUNT = Number(process.env.NOTARY_COUNT ?? 3);

const deployOutputPath = new URL("../deploy-output.json", import.meta.url);
const adminSecretPath = new URL("../admin-secret.local", import.meta.url);

interface DeployOutput {
  contractAddress: string;
  [key: string]: unknown;
}

const fetchPublicKey = async (
  port: number,
): Promise<{ id: string; publicKey: { x: string; y: string } }> => {
  const res = await fetch(`http://127.0.0.1:${port}/pubkey`);
  if (!res.ok) {
    throw new Error(`notary /pubkey on :${port} failed (${res.status})`);
  }
  const body = (await res.json()) as {
    notaryId: string;
    registeredPublicKey: { x: string; y: string };
  };
  return { id: body.notaryId, publicKey: body.registeredPublicKey };
};

const main = async () => {
  const output = JSON.parse(readFileSync(deployOutputPath, "utf-8")) as DeployOutput;
  const adminSecret = readFileSync(adminSecretPath, "utf-8").trim();

  console.log("[rotate-notaries] fetching running instance public keys...");
  const instances = [];
  for (let i = 0; i < NOTARY_COUNT; i += 1) {
    instances.push(await fetchPublicKey(NOTARY_BASE_PORT + i));
  }
  const newKeys = instances.map((instance) => ({
    x: BigInt(instance.publicKey.x),
    y: BigInt(instance.publicKey.y),
  }));
  console.log(
    "[rotate-notaries] keys:",
    instances.map((i) => `${i.id} 0x${i.publicKey.x.slice(0, 16)}...`).join("\n"),
  );

  console.log("[rotate-notaries] building wallet from genesis seed...");
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

  console.log("[rotate-notaries] joining contract", output.contractAddress);
  const adminPrivateState: PrivateState = createPrivateState(
    Buffer.from(adminSecret, "hex"),
    randomBytes(32),
  );
  const deployed = await findDeployedContract<StrideContractType>(providers, {
    contractAddress: output.contractAddress,
    compiledContract: CompactCompiledContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: adminPrivateState,
  });

  for (let i = 0; i < NOTARY_COUNT; i += 1) {
    console.log(`[rotate-notaries] rotateNotary(${i}) -> ${instances[i].id}`);
    await deployed.callTx.rotateNotary(BigInt(i), newKeys[i]);
  }

  const state$ = await providers.publicDataProvider.contractStateObservable(
    output.contractAddress,
    { type: "latest" },
  );
  await firstValueFrom(state$.pipe(timeout({ first: 30_000 })));
  console.log("[rotate-notaries] rotations submitted; state observable alive");

  const updated: DeployOutput = {
    ...output,
    notaryPublicKeys: newKeys,
    notaryInstances: instances.map((instance, i) => ({
      ...instance,
      port: NOTARY_BASE_PORT + i,
      slot: i,
    })),
    notarySeeds: undefined,
    registryRotatedAt: new Date().toISOString(),
  };
  const toJson = (value: unknown): string =>
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? "0x" + v.toString(16) : v), 2);
  writeFileSync(deployOutputPath, toJson(updated));
  console.log("[rotate-notaries] deploy-output.json updated");
  console.log(
    toJson({ contractAddress: output.contractAddress, notaryInstances: updated.notaryInstances }),
  );
  process.exit(0);
};

main().catch((error) => {
  console.error("[rotate-notaries] FAILED:", error);
  process.exitCode = 1;
});

// Minimal repro of the RpcError 1010 / Custom error: 192
// (InputsSignaturesLengthMismatch) on createWager (receiveUnshielded).
// Instruments balanceUnboundTransaction + finalizeRecipe to dump the
// unshielded offer input/signature counts at every stage, then submits and
// reports the node-side error. Run: pnpm --filter @witnessfitness/api exec tsx scripts/unshielded-probe.ts
import { randomBytes } from "node:crypto";
import { firstValueFrom } from "rxjs";
import { buildWallet, registerForDustGeneration } from "@witnessfitness/contract/wallet";
import { configureProviders } from "@witnessfitness/contract/providers";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import { encodeCoinPublicKey } from "@midnight-ntwrk/ledger-v8";
import {
  StrideContract,
  createWagerFlow,
  userAddressBytes,
  type WorkoutContext,
} from "../src/index.js";

const CONTRACT =
  process.env.CONTRACT_ADDRESS ??
  "cf80ad421b2b85f6ca1b3c0ccfd140ae5f6fc0d5871426d7750df4d42944cbaf";
const SEED =
  process.env.GENESIS_MINT_WALLET_SEED ??
  "0000000000000000000000000000000000000000000000000000000000000001";
const NIGHT = 10n ** 12n;

type OfferLike = {
  inputs?: unknown[];
  signatures?: unknown[];
};

const dumpOffer = (label: string, offer: OfferLike | undefined): void => {
  console.log(
    `[probe] ${label}: ${offer === undefined ? "none" : `inputs=${offer.inputs?.length ?? "?"} sigs=${offer.signatures?.length ?? "?"}`}`,
  );
};

const dumpIntents = (tx: { intents?: Map<number, unknown> } | undefined, label: string): void => {
  if (!tx?.intents || tx.intents.size === 0) {
    console.log(`[probe] ${label}: no intents`);
    return;
  }
  for (const [segment, raw] of tx.intents) {
    const intent = raw as {
      fallibleUnshieldedOffer?: OfferLike;
      guaranteedUnshieldedOffer?: OfferLike;
    };
    dumpOffer(`${label} seg ${segment} fallible`, intent.fallibleUnshieldedOffer);
    dumpOffer(`${label} seg ${segment} guaranteed`, intent.guaranteedUnshieldedOffer);
  }
};

const main = async (): Promise<void> => {
  const walletCtx = await buildWallet(
    {
      indexer: process.env.INDEXER_URL ?? "http://127.0.0.1:8088/api/v3/graphql",
      indexerWS: process.env.INDEXER_WS_URL ?? "ws://127.0.0.1:8088/api/v3/graphql/ws",
      node: process.env.NODE_URL ?? "http://127.0.0.1:9944",
      proofServer: process.env.PROOF_SERVER_URL ?? "http://127.0.0.1:6300",
    },
    SEED,
  );
  await registerForDustGeneration(walletCtx.wallet, walletCtx.unshieldedKeystore);
  const providers = await configureProviders(
    walletCtx,
    {
      indexer: process.env.INDEXER_URL ?? "http://127.0.0.1:8088/api/v3/graphql",
      indexerWS: process.env.INDEXER_WS_URL ?? "ws://127.0.0.1:8088/api/v3/graphql/ws",
      proofServer: process.env.PROOF_SERVER_URL ?? "http://127.0.0.1:6300",
    },
    "probe",
  );

  // Replace the providers' balanceTx with an SDK-native signing path:
  // balanceUnboundTransaction → signRecipe (SDK's own offer signing) →
  // finalizeRecipe. Dump offer input/signature counts at each stage.
  const signFn = (payload: Uint8Array) => walletCtx.unshieldedKeystore.signData(payload);
  providers.walletProvider.balanceTx = async (tx: never, ttl?: Date) => {
    const recipe = (await walletCtx.wallet.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
      { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
    )) as {
      type: string;
      baseTransaction: { intents?: Map<number, unknown> };
      balancingTransaction?: { intents?: Map<number, unknown> };
    };
    console.log("[probe] recipe type:", recipe.type);
    const baseIntent = recipe.baseTransaction.intents?.values().next().value as
      | {
          binding?: { instance?: string };
          fallibleUnshieldedOffer?: { inputs?: unknown[]; signatures?: unknown[] };
        }
      | undefined;
    console.log(
      "[probe] base intent binding:",
      baseIntent?.binding?.instance,
      "| fallible inputs:",
      baseIntent?.fallibleUnshieldedOffer?.inputs?.length,
      "sigs:",
      baseIntent?.fallibleUnshieldedOffer?.signatures?.length,
    );
    const signed = await walletCtx.wallet.signRecipe(recipe as never, signFn);
    const signedBase = (signed as { baseTransaction: { intents?: Map<number, unknown> } })
      .baseTransaction;
    const signedIntent = signedBase.intents?.values().next().value as
      | { fallibleUnshieldedOffer?: { inputs?: unknown[]; signatures?: unknown[] } }
      | undefined;
    console.log(
      "[probe] after signRecipe — fallible inputs:",
      signedIntent?.fallibleUnshieldedOffer?.inputs?.length,
      "sigs:",
      signedIntent?.fallibleUnshieldedOffer?.signatures?.length,
    );
    return walletCtx.wallet.finalizeRecipe(signed as never);
  };

  const holderSecret = randomBytes(32);
  const contract = await StrideContract.join(
    providers,
    CONTRACT,
    "probe",
    StrideContract.freshPrivateState(new Uint8Array(32), holderSecret),
  );
  const ctx: WorkoutContext = { contract, privateStateId: "probe", holderSecret };

  const state = await firstValueFrom(walletCtx.wallet.state());
  const bech32m = UnshieldedAddress.codec.encode(getNetworkId(), state.unshielded.address);
  const payout = userAddressBytes(
    UnshieldedAddress.codec.decode(getNetworkId(), bech32m).hexString,
  );
  const coinKey = { bytes: encodeCoinPublicKey(walletCtx.shieldedSecretKeys.coinPublicKey) };
  const deadlineBlock = BigInt(Math.floor(Date.now() / 1000)) + 600n;

  console.log("[probe] submitting createWager (stake 1 NIGHT)...");
  try {
    const tx = await createWagerFlow(ctx, {
      opponentBinding: 0x1234n,
      metricId: 1n,
      stake: NIGHT,
      deadlineBlock,
      payout,
      coinKey,
    });
    const txHash = (tx as { public?: { txHash?: unknown } })?.public?.txHash;
    console.log("[probe] SUCCESS, txHash:", txHash);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/RpcError: 1010: Invalid Transaction: Custom error: (\d+)/);
    console.log(`[probe] FAILED with custom error ${match ? match[1] : "unknown"}`);
    console.log(`[probe] ${message.split("\n")[0]}`);
  }
  process.exit(0);
};

main().catch((error) => {
  console.error("[probe] FATAL:", error);
  process.exitCode = 1;
});

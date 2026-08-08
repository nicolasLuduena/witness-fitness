import type { Contract as CompactContract } from "@midnight-ntwrk/compact-js";
import type { ContractProviders } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import type { MidnightProvider, WalletProvider } from "@midnight-ntwrk/midnight-js-types";
import path from "node:path";
import type { StrideContractType } from "./index.js";
import { createWalletAndMidnightProvider, type WalletContext } from "./wallet.js";

export { NodeZkConfigProvider };

const currentDir = path.resolve(new URL(import.meta.url).pathname, "..");
export const contractConfig = {
  zkConfigPath: path.resolve(currentDir, "managed", "stride"),
};

export const configureProviders = async (
  walletCtx: WalletContext,
  config: { indexer: string; indexerWS: string; proofServer: string },
  privateStateStoreName: string,
  zkConfigPath = contractConfig.zkConfigPath,
): Promise<ContractProviders<StrideContractType>> => {
  const walletAndMidnightProvider: WalletProvider & MidnightProvider =
    await createWalletAndMidnightProvider(walletCtx);
  const zkConfigProvider = new NodeZkConfigProvider<
    CompactContract.ProvableCircuitId<StrideContractType>
  >(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<
      string,
      CompactContract.PrivateState<StrideContractType>
    >({
      privateStateStoreName: privateStateStoreName + "-midnight",
      privateStoragePasswordProvider: function (): string | Promise<string> {
        return "MyM1dnightPassword!";
      },
      accountId: walletCtx.shieldedSecretKeys.coinPublicKey,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

// Browser-wallet provider stack (Track 0.1): Lace DApp Connector mode where
// the wallet ONLY funds gas. The app identity is a random 32-byte holder
// secret (never derived from wallet keys — non-linkable), and private state
// lives in an in-memory provider the UI can back up/restore via
// password-encrypted localStorage (in-memory-private-state-provider.ts).
// Mirrors midnight-reference-app/packages/api/src/browser.ts.
//
// Seam contract for the UI agent (exact names/shapes):
//   initializeProviders(connectedAPI)          → StrideProviders
//   joinStrideFromBrowser(connectedAPI, contractAddress, privateStateId)
//                                              → Promise<StrideContract>
//   deriveBrowserHolderSecret()                → Uint8Array (32 random bytes)
//   inMemoryPrivateStateProvider<PSI, PS>()    → provider factory + export/import/reset hooks
//   exportPrivateState(password, storeName)    → Promise<string> (encrypted payload)
//   importPrivateState(password, storeName, payload) → Promise<void>
//   resetPrivateState(storeName)               → Promise<void>
//
// The three persistence functions operate on the module-level singleton
// provider — the SAME map initializeProviders/joinStrideFromBrowser use — so
// a backup captured at any point covers whatever the wallet flow has stored.
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { fromHex, toHex } from '@midnight-ntwrk/compact-runtime';
import {
  Binding,
  FinalizedTransaction,
  Proof,
  SignatureEnabled,
  Transaction,
  TransactionId,
} from '@midnight-ntwrk/ledger-v8';
import type { Contract as CompactContract } from '@midnight-ntwrk/compact-js';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { createPrivateState, type PrivateState, type StrideContractType } from '@witnessfitness/contract';
import { inMemoryPrivateStateProvider } from './in-memory-private-state-provider.js';
import { StrideContract, type StrideProviders } from './index.js';

export { inMemoryPrivateStateProvider } from './in-memory-private-state-provider.js';

// Page-load singleton: one map for the provider stack AND the backup/restore
// surface (P0-3). Do not create providers per call.
export const browserPrivateStateProvider = inMemoryPrivateStateProvider<string, PrivateState>();

export const exportPrivateState = (password: string, storeName: string): Promise<string> =>
  browserPrivateStateProvider.exportPrivateState(password, storeName);

export const importPrivateState = (
  password: string,
  storeName: string,
  payload: string
): Promise<void> => browserPrivateStateProvider.importPrivateState(password, storeName, payload);

export const resetPrivateState = (storeName: string): Promise<void> =>
  Promise.resolve(browserPrivateStateProvider.resetPrivateState(storeName));

export const initializeProviders = async (connectedAPI: ConnectedAPI): Promise<StrideProviders> => {
  const zkConfigPath = `${window.location.origin}/managed/stride`;
  const keyMaterialProvider = new FetchZkConfigProvider<
    CompactContract.ProvableCircuitId<StrideContractType>
  >(zkConfigPath, fetch.bind(window));
  const config = await connectedAPI.getConfiguration();
  const shieldedAddresses = await connectedAPI.getShieldedAddresses();
  return {
    privateStateProvider: browserPrivateStateProvider,
    zkConfigProvider: keyMaterialProvider,
    proofProvider: httpClientProofProvider(config.proverServerUri!, keyMaterialProvider),
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    // The wallet signs/balances only — the holder secret never touches it.
    walletProvider: {
      getCoinPublicKey(): string {
        return shieldedAddresses.shieldedCoinPublicKey;
      },
      getEncryptionPublicKey(): string {
        return shieldedAddresses.shieldedEncryptionPublicKey;
      },
      balanceTx: async (tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> => {
        const serializedTx = toHex(tx.serialize());
        const received = await connectedAPI.balanceUnsealedTransaction(serializedTx);
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          'signature',
          'proof',
          'binding',
          fromHex(received.tx)
        );
      },
    },
    midnightProvider: {
      submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
        await connectedAPI.submitTransaction(toHex(tx.serialize()));
        const txId = tx.identifiers()[0];
        return txId;
      },
    },
  };
};

// Random 32-byte app identity — never derived from wallet keys. The UI stores
// it alongside the exported private state so a user can resume on any device.
export const deriveBrowserHolderSecret = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

// Convenience join for the browser: fresh providers + a fresh holder secret.
// The admin secret is zeroed — the contract's isAdmin circuit requires
// adminSecret != 0 AND a matching binding, so a zero key can never act as
// admin (safe on the deployed contract where adminSecret is pinned).
export const joinStrideFromBrowser = async (
  connectedAPI: ConnectedAPI,
  contractAddress: string,
  privateStateId: string
): Promise<StrideContract> => {
  const providers = await initializeProviders(connectedAPI);
  return StrideContract.join(
    providers,
    contractAddress,
    privateStateId,
    createPrivateState(new Uint8Array(32), deriveBrowserHolderSecret())
  );
};

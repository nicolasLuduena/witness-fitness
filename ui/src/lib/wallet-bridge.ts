// The wallet-mode seam to @witnessfitness/api/browser (Track 0.2 contract,
// built in parallel by the api workstream):
//
//   initializeProviders(connectedAPI)            → StrideProviders
//   exportPrivateState(password, storeName)      → encrypted payload string
//   importPrivateState(password, storeName, payload) → void
//   resetPrivateState(storeName)                 → void
//   deriveBrowserHolderSecret()                  → Uint8Array (deterministic
//                                                  per wallet address)
//   joinStrideFromBrowser(connectedAPI, contractAddress, privateStateId)
//                                                → StrideContract (with the
//                                                  demo flows from api/src)
//
// The api module has NOT landed yet: this module loads it at runtime and
// falls back to the local stub (createStubWalletBridge). When the real
// module ships, swap the dynamic import below for a static one — one line.
//
// The session surface exposed to the UI (WalletStrideSession) wraps the api
// flows (attestWorkout / advanceStreakFlow / mintBadgeFlow / proveBadgeFlow)
// plus readState — the UI never touches notaries or private state directly.

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { createHash } from 'node:crypto';
import { NOTARY_URLS } from '../config';

export interface WalletMetric {
  metricId: number | string;
  label: string;
  value: number | string;
}

export interface WalletVaultEntry {
  vaultKey?: string;
  key?: string;
  timestamp?: number | string;
  metrics?: WalletMetric[];
  metric?: WalletMetric;
}

export interface WalletLedgerState {
  vault: WalletVaultEntry[];
  streaks: { count?: number | string; lastDay?: number | string } | Array<{ count?: number | string; lastDay?: number | string }>;
  badges: Array<{ badgeId?: number | string; id?: number | string; minted?: boolean }>;
}

export interface WalletStrideSession {
  contractAddress: string;
  attest(artifacts: {
    claim: unknown;
    signatureHex: string;
    attestorAddress: string;
    request?: { url: string; method: string; publicHeaders: Record<string, string> };
    responseText?: string;
    extractedParameterValues?: Record<string, string>;
  }): Promise<{ vaultKey: Uint8Array; txHash: string; metrics: WalletMetric[] }>;
  advanceStreak(vaultKey: Uint8Array): Promise<{ streakCount: bigint; lastDay: bigint }>;
  mintBadge(badgeId: number, vaultKey: Uint8Array): Promise<{ minted: boolean }>;
  proveBadge(badgeId: number, verifierBinding: bigint): Promise<{ verified: boolean; verifierBinding: bigint }>;
  readState(): Promise<WalletLedgerState>;
}

export interface WalletBridge {
  initializeProviders(connectedAPI: ConnectedAPI): Promise<unknown>;
  exportPrivateState(password: string, storeName: string): Promise<string>;
  importPrivateState(password: string, storeName: string, payload: string): Promise<void>;
  resetPrivateState(storeName: string): Promise<void>;
  deriveBrowserHolderSecret(): Uint8Array;
  joinStrideFromBrowser(
    connectedAPI: ConnectedAPI,
    contractAddress: string,
    privateStateId: string
  ): Promise<WalletStrideSession>;
}

export class WalletBridgeNotImplementedError extends Error {
  constructor(feature: string) {
    super(`@witnessfitness/api/browser not available yet — ${feature} (stub) is not implemented`);
    this.name = 'WalletBridgeNotImplementedError';
  }
}

// ---------------------------------------------------------------- stub ----

interface StoredState {
  holderSecretHex: string;
  vault: Array<{ vaultKey: string; timestamp: string; metrics: WalletMetric[] }>;
  streakCount: number;
  lastDay: number;
  badges: number[];
  attestations: Array<{ artifactsJson: string; commitRandHex: string; vaultKeyHex: string; metrics: WalletMetric[] }>;
}

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf-8').digest('hex');

const hexOf = (bytes: Uint8Array): string =>
  '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

export const createStubWalletBridge = (): WalletBridge => {
  // Module-level store keyed by storeName — survives page reloads within a
  // session; export/import is the durable path (localStorage in the UI).
  const stores = new Map<string, StoredState>();
  let lastConnected: ConnectedAPI | null = null;
  let lastContractAddress = '';

  const addressOf = async (api: ConnectedAPI): Promise<string> => {
    const shielded = await api.getShieldedAddresses();
    return shielded.shieldedCoinPublicKey;
  };

  const stubSession = (_api: ConnectedAPI, storeName: string): WalletStrideSession => {
    const state = (): StoredState => {
      let s = stores.get(storeName);
      if (!s) {
        s = {
          holderSecretHex: sha256Hex(`witnessfitness:wallet:${lastContractAddress}:${storeName}`),
          vault: [],
          streakCount: 0,
          lastDay: 0,
          badges: [],
          attestations: [],
        };
        stores.set(storeName, s);
      }
      return s;
    };

    return {
      contractAddress: lastContractAddress,
      attest: async (artifacts) => {
        const s = state();
        const metricsJson = (artifacts.responseText ?? '').match(/"distance"\s*:\s*([0-9.]+)/);
        const distance = metricsJson ? Math.round(Number(metricsJson[1])) : 0;
        const metrics: WalletMetric[] = distance > 0 ? [{ metricId: '0x1', label: 'distance', value: String(distance) }] : [];
        const commitRand = crypto.getRandomValues(new Uint8Array(32));
        const vaultKey = crypto.getRandomValues(new Uint8Array(32));
        const vaultKeyHex = hexOf(vaultKey);
        s.attestations.push({
          artifactsJson: JSON.stringify(artifacts),
          commitRandHex: hexOf(commitRand),
          vaultKeyHex,
          metrics,
        });
        s.vault.unshift({ vaultKey: vaultKeyHex, timestamp: String(Date.now()), metrics });
        return { vaultKey, txHash: '0x' + sha256Hex(`wf-tx:${vaultKeyHex}:${Date.now()}`).slice(0, 64), metrics };
      },
      advanceStreak: async (vaultKey) => {
        const s = state();
        if (!s.attestations.some((a) => a.vaultKeyHex === hexOf(vaultKey))) {
          throw new Error('unknown credential — attest first');
        }
        s.streakCount = 1;
        s.lastDay = Math.floor(Date.now() / 86_400_000);
        return { streakCount: BigInt(s.streakCount), lastDay: BigInt(s.lastDay) };
      },
      mintBadge: async (badgeId, vaultKey) => {
        const s = state();
        const a = s.attestations.find((x) => x.vaultKeyHex === hexOf(vaultKey));
        if (!a) throw new Error('unknown credential — attest first');
        const distance = Number(a.metrics[0]?.value ?? 0);
        if (badgeId === 1 && s.streakCount < 3) throw new Error('failed assert: Streak badge requires streak >= 3');
        if (badgeId === 2 && distance < 10_000) throw new Error('failed assert: Distance below threshold');
        if (!s.badges.includes(badgeId)) s.badges.push(badgeId);
        return { minted: true };
      },
      proveBadge: async (badgeId, verifierBinding) => {
        const s = state();
        if (!s.badges.includes(badgeId)) throw new Error('not a badge holder');
        return { verified: true, verifierBinding };
      },
      readState: async () => {
        const s = state();
        return {
          vault: s.vault,
          streaks: { count: String(s.streakCount), lastDay: String(s.lastDay) },
          badges: s.badges.map((id) => ({ badgeId: String(id), minted: true })),
        };
      },
    };
  };

  return {
    initializeProviders: async (api) => {
      lastConnected = api;
      return {};
    },
    exportPrivateState: async (password, storeName) => {
      const s = stores.get(storeName);
      if (!s) throw new Error('no private state to export — attest first');
      // Stub of the real AEAD envelope: the payload carries a password
      // check so import validates against the payload, not a remembered
      // password (the real bridge decrypts with the supplied password).
      return btoa(JSON.stringify({ data: s, passwordHash: sha256Hex(password) }));
    },
    importPrivateState: async (password, storeName, payload) => {
      const parsed = JSON.parse(atob(payload)) as { data?: StoredState; passwordHash?: string };
      if (!parsed.data || parsed.passwordHash !== sha256Hex(password)) {
        throw new Error('wrong backup password');
      }
      stores.set(storeName, parsed.data);
    },
    resetPrivateState: async (storeName) => {
      stores.delete(storeName);
    },
    deriveBrowserHolderSecret: () => {
      if (!lastConnected) throw new Error('wallet not connected');
      void addressOf(lastConnected); // async probe — the real impl uses wallet signing
      return new Uint8Array(createHash('sha256').update('witnessfitness:holder:stub').digest());
    },
    joinStrideFromBrowser: async (api, contractAddress, privateStateId) => {
      lastConnected = api;
      lastContractAddress = contractAddress;
      // The stub keys its private state by the privateStateId the caller
      // passes — the WalletClient passes walletStoreName(coinPublicKey), so
      // export/import with that storeName roundtrips the session state.
      return stubSession(api, privateStateId);
    },
  };
};

let stubSingleton: WalletBridge | null = null;

// --------------------------------------------------------------- loader ---

export const loadWalletBridge = async (): Promise<WalletBridge> => {
  const specifier = '@witnessfitness/api/browser';
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      initializeProviders: (api: ConnectedAPI) => Promise<unknown>;
      exportPrivateState: (password: string, storeName: string) => Promise<string>;
      importPrivateState: (password: string, storeName: string, payload: string) => Promise<void>;
      resetPrivateState: (storeName: string) => Promise<void>;
      deriveBrowserHolderSecret: () => Uint8Array;
      joinStrideFromBrowser: (
        api: ConnectedAPI,
        contractAddress: string,
        privateStateId: string
      ) => Promise<WalletStrideSession>;
    };
    return {
      initializeProviders: (api) => mod.initializeProviders(api),
      exportPrivateState: (password, storeName) => mod.exportPrivateState(password, storeName),
      importPrivateState: (password, storeName, payload) => mod.importPrivateState(password, storeName, payload),
      resetPrivateState: (storeName) => mod.resetPrivateState(storeName),
      deriveBrowserHolderSecret: () => mod.deriveBrowserHolderSecret(),
      joinStrideFromBrowser: (api, contractAddress, privateStateId) =>
        mod.joinStrideFromBrowser(api, contractAddress, privateStateId),
    };
  } catch {
    console.warn('[wallet-bridge] @witnessfitness/api/browser not available — using the local stub');
    stubSingleton ??= createStubWalletBridge();
    return stubSingleton;
  }
};

export { NOTARY_URLS };

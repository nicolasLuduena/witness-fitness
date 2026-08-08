// The wallet-mode seam to @witnessfitness/api/browser (Track 0.2 contract):
//
//   initializeProviders(connectedAPI)            → StrideProviders
//   exportPrivateState(password, storeName)      → encrypted payload string
//   importPrivateState(password, storeName, payload) → void
//   resetPrivateState(storeName)                 → void
//   deriveBrowserHolderSecret()                  → Uint8Array (deterministic
//                                                  per wallet address)
//   joinStrideFromBrowser(connectedAPI, contractAddress, privateStateId)
//                                                → WalletStrideSession
//
// Round 2D: the session now carries the REAL attestation path (notary fan-out
// via NotaryClient → attestWorkout) and the live wager surface
// (create/accept/submit/settle with private-state staging of submissionRand
// and wagerOpenings). The real api module is loaded at runtime; when it is
// unavailable (tests, first load), the local stub takes over with the same
// surface.

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { NOTARY_URLS } from '../config';
import { logError } from './logger';
import type { LedgerMapLike } from './state-mappers';

// Deterministic 32-byte (64-hex) digest for the TEST stub — FNV-1a expanded
// over 32 lanes. Dependency-free + synchronous + identical in Node and the
// browser. The stub bridge never runs in the browser's real path (the real
// bridge uses WebCrypto via @witnessfitness/api/browser); node:crypto is
// deliberately NOT imported here (vite externalizes it in the browser, which
// crashed the page at import time).
const sha256Hex = (value: string): string => {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    let h = (0x811c9dc5 ^ (i * 0x9e3779b1)) >>> 0;
    for (let j = 0; j < value.length; j++) {
      h ^= value.charCodeAt(j);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out[i] = h & 0xff;
  }
  return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('');
};

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

// readState shapes — the REAL adapter returns the contract LEDGER's Map-like
// ADTs (member/lookup/iterator, per the stride contract index.d.ts), while the
// stub emits plain arrays/objects. UI mappers accept both (state-mappers).
export interface WalletLedgerState {
  vault: WalletVaultEntry[] | LedgerMapLike<Uint8Array, { holderBinding: bigint; timestamp: bigint }>;
  streaks:
    | { count?: number | string; lastDay?: number | string }
    | Array<{ count?: number | string; lastDay?: number | string }>
    | LedgerMapLike<bigint, { count: bigint; lastDay: bigint }>;
  badges:
    | Array<{ badgeId?: number | string; id?: number | string; minted?: boolean }>
    | LedgerMapLike<bigint, Iterable<bigint>>;
}

// The proof artifacts the notary strip consumes (proofToNotaryArtifacts
// output from ui/src/lib/attest/attest-browser.ts). signatureHex and
// claimSignatureHex are aliases — the notary's normalizeArtifacts accepts
// either (the browser path emits claimSignatureHex).
export interface WalletProofArtifacts {
  claim: unknown;
  signatureHex?: string;
  claimSignatureHex?: string;
  attestorAddress: string;
  request?: { url: string; method: string; publicHeaders: Record<string, string> };
  responseText?: string;
  extractedParameterValues?: Record<string, string>;
}

// The notarized attestation a submit/streak/badge flow re-stages into the
// private state (prepareAttestation reads assertion + signatures + commitRand).
export interface WalletAttestation {
  assertion: unknown;
  signatures: unknown[];
  commitRand: Uint8Array;
  vaultKey: Uint8Array;
}

export interface WalletWagerOpening {
  value: bigint;
  rand: bigint;
}

export interface WalletWagerRouting {
  payout: Uint8Array;
  coinKey: { bytes: Uint8Array };
}

export interface WalletWagerView {
  id: bigint;
  challenger: bigint;
  opponent: bigint;
  metricId: bigint;
  stake: bigint;
  deadlineBlock: bigint;
  accepted: boolean;
  settled: boolean;
  challengerSubmission: { is_some: boolean; value: bigint };
  opponentSubmission: { is_some: boolean; value: bigint };
}

export interface WalletAttestResult {
  vaultKey: Uint8Array;
  txHash: string;
  metrics: WalletMetric[];
  attestation: WalletAttestation;
}

export interface WalletStrideSession {
  contractAddress: string;
  // My on-chain holder binding (0x-hex, 64 chars) — the challenge ID the
  // other browser pastes to challenge me.
  holderBinding: string;
  attest(artifacts: WalletProofArtifacts): Promise<WalletAttestResult>;
  listWagers(): Promise<WalletWagerView[]>;
  createWager(input: {
    opponentBinding: bigint;
    metricId: bigint;
    stake: bigint;
    deadlineBlock: bigint;
    routing: WalletWagerRouting;
  }): Promise<{ txHash: string }>;
  acceptWager(id: bigint, routing: WalletWagerRouting): Promise<{ txHash: string }>;
  // value is the attestation's claim for the wager metric; submissionRand
  // must be staged via stageSubmissionRand BEFORE calling (the contract seals
  // transientCommit(value, submissionRand) from the private state).
  submitWorkout(
    wagerId: bigint,
    attestation: WalletAttestation,
    value: bigint
  ): Promise<{ txHash: string }>;
  settleWager(
    id: bigint,
    openings: { challenger: WalletWagerOpening; opponent: WalletWagerOpening }
  ): Promise<{ txHash: string }>;
  stageSubmissionRand(rand: bigint): Promise<void>;
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

interface StubWagerRecord {
  challenger: bigint;
  opponent: bigint;
  metricId: bigint;
  stake: bigint;
  deadlineBlock: bigint;
  accepted: boolean;
  settled: boolean;
  submissions: { challenger: WalletWagerOpening | null; opponent: WalletWagerOpening | null };
}

interface StoredState {
  holderSecretHex: string;
  vault: Array<{ vaultKey: string; timestamp: string; metrics: WalletMetric[] }>;
  streakCount: number;
  lastDay: number;
  badges: number[];
  attestations: Array<{ artifactsJson: string; commitRandHex: string; vaultKeyHex: string; metrics: WalletMetric[] }>;
}

const hexOf = (bytes: Uint8Array): string =>
  '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

export const createStubWalletBridge = (): WalletBridge => {
  // Module-level store keyed by storeName — survives page reloads within a
  // session; export/import is the durable path (localStorage in the UI).
  const stores = new Map<string, StoredState>();
  // Wagers are SHARED chain state — visible to every session (two browsers).
  const wagers = new Map<bigint, StubWagerRecord>();
  let nextWagerId = 1n;
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

    let stagedSubmissionRand = 1n;

    return {
      contractAddress: lastContractAddress,
      holderBinding: '0x' + sha256Hex(storeName).slice(0, 64),
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
        return {
          vaultKey,
          txHash: '0x' + sha256Hex(`wf-tx:${vaultKeyHex}:${Date.now()}`).slice(0, 64),
          metrics,
          attestation: {
            assertion: { provider: 0n, claims: [{ metricId: 1n, value: BigInt(distance) }] },
            signatures: [],
            commitRand,
            vaultKey,
          },
        };
      },
      listWagers: async () =>
        Array.from(wagers.entries()).map(([id, w]) => ({
          id,
          challenger: w.challenger,
          opponent: w.opponent,
          metricId: w.metricId,
          stake: w.stake,
          deadlineBlock: w.deadlineBlock,
          accepted: w.accepted,
          settled: w.settled,
          challengerSubmission: w.submissions.challenger
            ? { is_some: true, value: w.submissions.challenger.value }
            : { is_some: false, value: 0n },
          opponentSubmission: w.submissions.opponent
            ? { is_some: true, value: w.submissions.opponent.value }
            : { is_some: false, value: 0n },
        })),
      createWager: async ({ opponentBinding, metricId, stake, deadlineBlock, routing }) => {
        void routing;
        const id = nextWagerId;
        nextWagerId += 1n;
        wagers.set(id, {
          challenger: BigInt('0x' + sha256Hex(storeName).slice(0, 64)),
          opponent: opponentBinding,
          metricId,
          stake,
          deadlineBlock,
          accepted: false,
          settled: false,
          submissions: { challenger: null, opponent: null },
        });
        return { txHash: '0x' + sha256Hex(`wf-create:${id}`).slice(0, 64) };
      },
      acceptWager: async (id) => {
        const w = wagers.get(id);
        if (!w) throw new Error('unknown wager');
        if (w.accepted) throw new Error('wager already accepted');
        w.accepted = true;
        return { txHash: '0x' + sha256Hex(`wf-accept:${id}`).slice(0, 64) };
      },
      submitWorkout: async (wagerId, attestation, value) => {
        const w = wagers.get(wagerId);
        if (!w) throw new Error('unknown wager');
        const s = state();
        const mine = BigInt('0x' + sha256Hex(storeName).slice(0, 64));
        const opening = { value, rand: stagedSubmissionRand };
        if (w.challenger === mine) {
          if (w.submissions.challenger) throw new Error('already submitted');
          w.submissions.challenger = opening;
        } else {
          if (w.submissions.opponent) throw new Error('already submitted');
          w.submissions.opponent = opening;
        }
        void attestation;
        void s;
        return { txHash: '0x' + sha256Hex(`wf-submit:${wagerId}:${mine}`).slice(0, 64) };
      },
      settleWager: async (id, openings) => {
        const w = wagers.get(id);
        if (!w) throw new Error('unknown wager');
        if (w.settled) throw new Error('wager settled');
        const match = (expected: WalletWagerOpening | null, actual: WalletWagerOpening) =>
          expected !== null && expected.value === actual.value && expected.rand === actual.rand;
        if (!match(w.submissions.challenger, openings.challenger)) {
          throw new Error('challenger opening does not match the sealed submission');
        }
        if (!match(w.submissions.opponent, openings.opponent)) {
          throw new Error('opponent opening does not match the sealed submission');
        }
        w.settled = true;
        return { txHash: '0x' + sha256Hex(`wf-settle:${id}`).slice(0, 64) };
      },
      stageSubmissionRand: async (rand) => {
        stagedSubmissionRand = rand;
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
      // Random 32 bytes, matching the real deriveBrowserHolderSecret
      // (api/browser) — determinism comes from persistence, not derivation.
      return crypto.getRandomValues(new Uint8Array(32));
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

const txHashOf = (tx: unknown): string => {
  const publicData = (tx as { public?: { txHash?: unknown } } | undefined)?.public;
  return publicData && typeof publicData.txHash === 'string' ? publicData.txHash : '';
};

const claimsToMetrics = (claims: unknown): WalletMetric[] => {
  if (!Array.isArray(claims)) return [];
  return claims.map((raw) => {
    const claim = raw as { metricId?: unknown; value?: unknown };
    const metricId = typeof claim.metricId === 'bigint' ? claim.metricId : BigInt(String(claim.metricId ?? 0));
    const value = typeof claim.value === 'bigint' ? claim.value : BigInt(String(claim.value ?? 0));
    const label = metricId === 1n ? 'distance' : metricId === 2n ? 'moving time' : `metric ${metricId}`;
    return { metricId: '0x' + metricId.toString(16), label, value: value.toString() };
  });
};

// Adapt the real StrideContract (api/browser) onto the session surface:
// notary fan-out + the api demo flows + private-state staging.
const adaptStrideSession = async (
  api: ConnectedAPI,
  contractAddress: string,
  privateStateId: string
): Promise<WalletStrideSession> => {
  const browserMod = (await import(/* @vite-ignore */ '@witnessfitness/api/browser')) as unknown as {
    joinStrideFromBrowser: (
      api: ConnectedAPI,
      contractAddress: string,
      privateStateId: string
    ) => Promise<{
      providers: {
        privateStateProvider: {
          setContractAddress(address: string): void;
          get(id: string): Promise<unknown>;
          set(id: string, state: unknown): Promise<void>;
        };
      };
      contractAddress: string;
      readState(): Promise<{
        vault: unknown[];
        streaks: {
          member(key: bigint): boolean;
          lookup(key: bigint): { count: bigint; lastDay: bigint };
          [Symbol.iterator](): Iterator<[bigint, unknown]>;
        };
        badges: unknown[];
        wagers: { [Symbol.iterator](): Iterator<[bigint, unknown]> };
      }>;
    }>;
  };
  const apiMod = (await import(/* @vite-ignore */ '@witnessfitness/api')) as unknown as {
    NotaryClient: new (urls: string[]) => { attestate(artifacts: unknown): Promise<unknown> };
    attestWorkout(
      ctx: unknown,
      attestation: unknown,
      commitRand: Uint8Array
    ): Promise<{ vaultKey: Uint8Array; tx: unknown }>;
    createWagerFlow(ctx: unknown, input: unknown): Promise<unknown>;
    acceptWagerFlow(ctx: unknown, id: bigint, routing: unknown): Promise<unknown>;
    submitWorkoutFlow(
      ctx: unknown,
      attestation: unknown,
      commitRand: Uint8Array,
      wagerId: bigint,
      vaultKey: Uint8Array,
      value: bigint
    ): Promise<unknown>;
    settleWagerFlow(ctx: unknown, id: bigint): Promise<unknown>;
    advanceStreakFlow(
      ctx: unknown,
      attestation: unknown,
      commitRand: Uint8Array,
      vaultKey: Uint8Array,
      day: bigint
    ): Promise<unknown>;
    mintBadgeFlow(
      ctx: unknown,
      attestation: unknown,
      commitRand: Uint8Array,
      badgeId: bigint,
      vaultKey: Uint8Array
    ): Promise<unknown>;
    proveBadgeFlow(ctx: unknown, badgeId: bigint, verifierBinding: bigint): Promise<unknown>;
  };
  const contractMod = (await import(/* @vite-ignore */ '@witnessfitness/contract')) as unknown as {
    pureCircuits: { holderBinding(secret: Uint8Array): bigint };
  };

  const contract = await browserMod.joinStrideFromBrowser(api, contractAddress, privateStateId);
  const providers = contract.providers;
  providers.privateStateProvider.setContractAddress(contractAddress);
  const stored = (await providers.privateStateProvider.get(privateStateId)) as
    | { holderSecret?: Uint8Array }
    | null
    | undefined;
  const holderSecret = stored?.holderSecret ?? new Uint8Array(32);
  const holderBinding =
    '0x' + contractMod.pureCircuits.holderBinding(holderSecret).toString(16).padStart(64, '0');
  const ctx = { contract, privateStateId, holderSecret };
  const notaryClient = new apiMod.NotaryClient(NOTARY_URLS);

  const stage = async (patch: Record<string, unknown>): Promise<void> => {
    const existing =
      ((await providers.privateStateProvider.get(privateStateId)) as Record<string, unknown> | null | undefined) ?? {};
    await providers.privateStateProvider.set(privateStateId, { ...existing, ...patch });
  };

  // The private state holds only the LATEST staged attestation — the flows
  // re-stage it (assertion + signatures + commitRand) before the circuit call.
  const stagedAttestation = async (): Promise<{
    assertion: unknown;
    signatures: unknown[];
    commitRand: Uint8Array;
    notaryIds: string[];
    metricSource: string;
    identifier: string;
  }> => {
    const ps = (await providers.privateStateProvider.get(privateStateId)) as
      | { assertion?: unknown; signatures?: unknown[]; commitRand?: Uint8Array }
      | null
      | undefined;
    if (!ps?.assertion) {
      throw new Error('no attestation staged — attest a workout first');
    }
    return {
      assertion: ps.assertion,
      signatures: ps.signatures ?? [],
      commitRand: ps.commitRand ?? new Uint8Array(32),
      notaryIds: [],
      metricSource: 'strava',
      identifier: '',
    };
  };

  return {
    contractAddress,
    holderBinding,
    attest: async (artifacts) => {
      const notarized = (await notaryClient.attestate(artifacts)) as {
        assertion: unknown;
        signatures: unknown[];
      };
      const commitRand = crypto.getRandomValues(new Uint8Array(32));
      const { vaultKey, tx } = await apiMod.attestWorkout(ctx, notarized, commitRand);
      return {
        vaultKey,
        txHash: txHashOf(tx),
        metrics: claimsToMetrics((notarized.assertion as { claims?: unknown }).claims),
        attestation: {
          assertion: notarized.assertion,
          signatures: notarized.signatures,
          commitRand,
          vaultKey,
        },
      };
    },
    listWagers: async () => {
      const state = await contract.readState();
      return Array.from(state.wagers).map(([id, raw]) => {
        const w = raw as {
          challenger: bigint;
          opponent: bigint;
          metricId: bigint;
          stake: bigint;
          deadlineBlock: bigint;
          accepted: boolean;
          settled: boolean;
          challengerSubmission: { is_some: boolean; value: bigint };
          opponentSubmission: { is_some: boolean; value: bigint };
        };
        return { id, ...w };
      });
    },
    createWager: async (input) => {
      const tx = await apiMod.createWagerFlow(ctx, input);
      return { txHash: txHashOf(tx) };
    },
    acceptWager: async (id, routing) => {
      const tx = await apiMod.acceptWagerFlow(ctx, id, routing);
      return { txHash: txHashOf(tx) };
    },
    submitWorkout: async (wagerId, attestation, value) => {
      const tx = await apiMod.submitWorkoutFlow(
        ctx,
        attestation.assertion,
        attestation.commitRand,
        wagerId,
        attestation.vaultKey,
        value
      );
      return { txHash: txHashOf(tx) };
    },
    settleWager: async (id, openings) => {
      await stage({
        wagerOpenings: [
          openings.challenger.value,
          openings.challenger.rand,
          openings.opponent.value,
          openings.opponent.rand,
        ] as [bigint, bigint, bigint, bigint],
      });
      const tx = await apiMod.settleWagerFlow(ctx, id);
      return { txHash: txHashOf(tx) };
    },
    stageSubmissionRand: async (rand) => {
      await stage({ submissionRand: rand });
    },
    advanceStreak: async (vaultKey) => {
      const staged = await stagedAttestation();
      const ts = (staged.assertion as { timestamp?: bigint }).timestamp ?? 0n;
      const day = BigInt(Math.floor(Number(ts) / 86_400));
      await apiMod.advanceStreakFlow(ctx, staged, staged.commitRand, vaultKey, day);
      const state = await contract.readState();
      const binding = BigInt(holderBinding);
      const streak = state.streaks.member(binding)
        ? state.streaks.lookup(binding)
        : { count: 0n, lastDay: 0n };
      return { streakCount: streak.count, lastDay: streak.lastDay };
    },
    mintBadge: async (badgeId, vaultKey) => {
      const staged = await stagedAttestation();
      await apiMod.mintBadgeFlow(ctx, staged, staged.commitRand, BigInt(badgeId), vaultKey);
      return { minted: true };
    },
    proveBadge: async (badgeId, verifierBinding) => {
      await apiMod.proveBadgeFlow(ctx, BigInt(badgeId), verifierBinding);
      return { verified: true, verifierBinding };
    },
    readState: async () => {
      const state = await contract.readState();
      return {
        vault: state.vault as WalletLedgerState['vault'],
        streaks: state.streaks as WalletLedgerState['streaks'],
        badges: state.badges as WalletLedgerState['badges'],
      };
    },
  };
};

export const loadWalletBridge = async (): Promise<WalletBridge> => {
  try {
    // Probe the api module exists; the session adapter does the heavy lifting.
    const mod = (await import(/* @vite-ignore */ '@witnessfitness/api/browser')) as unknown as {
      initializeProviders: (api: ConnectedAPI) => Promise<unknown>;
      exportPrivateState: (password: string, storeName: string) => Promise<string>;
      importPrivateState: (password: string, storeName: string, payload: string) => Promise<void>;
      resetPrivateState: (storeName: string) => Promise<void>;
      deriveBrowserHolderSecret: () => Uint8Array;
    };
    return {
      initializeProviders: (api) => mod.initializeProviders(api),
      exportPrivateState: (password, storeName) => mod.exportPrivateState(password, storeName),
      importPrivateState: (password, storeName, payload) => mod.importPrivateState(password, storeName, payload),
      resetPrivateState: (storeName) => mod.resetPrivateState(storeName),
      deriveBrowserHolderSecret: () => mod.deriveBrowserHolderSecret(),
      joinStrideFromBrowser: (api, contractAddress, privateStateId) =>
        adaptStrideSession(api, contractAddress, privateStateId),
    };
  } catch (err) {
    // NO STUB FALLBACK in the browser (user decree — silent mocks are bad
    // behavior): a real-bridge failure must be loud and visible. The local
    // stub remains reachable ONLY in test mode (vitest) where the real api
    // module isn't part of the graph.
    if (import.meta.env.MODE === 'test') {
      logError('wallet-bridge.load (using local stub in tests)', err);
      stubSingleton ??= createStubWalletBridge();
      return stubSingleton;
    }
    logError('wallet-bridge.load (REAL bridge failed — no fallback)', err);
    throw new Error(
      `wallet bridge failed to load: ${err instanceof Error ? err.message : String(err)} — see the console`
    );
  }
};

export { NOTARY_URLS };

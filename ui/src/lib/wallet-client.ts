// WALLET-mode implementation of the WfClient contract (Track 0.2).
// Connects the demo to the contract DIRECTLY through a browser wallet (Lace,
// DApp Connector) — no sidecar. The holder secret is deterministic per wallet
// address; the private state (attestations, commit rands, openings) persists
// in the api's browser private-state store and can be backed up / restored
// via the encrypted export/import bridge (backup/resume UX on Connect).
//
// Flows: attest (fixture replay → notaries → wallet-signed verifyAttestation),
// vault/streak/badge via the api flows through the bridge session. Wagers stay
// fixture-only (decided — Track 1 adds live wagers).

import type { DemoMode } from '../config';
import { NOTARY_URLS } from '../config';
import type {
  AttestedCredential,
  AttestOutcome,
  AttestationStage,
  BadgeProof,
  BadgeView,
  ClientSession,
  NotaryInfo,
  StreakView,
  WagerCreateRequest,
  WagerSettleResult,
  WagerView,
} from '../domain/types';
import { ATHLETE_A, ATTESTATION_LOG, BADGES } from '../domain/story';
import { displayHash, hexShort } from './format';
import { notaryHealth } from './notary-api';
import { connectWallet, type WalletConnection } from './wallet-connector';
import { loadWalletBridge, type WalletStrideSession } from './wallet-bridge';
import { badgeViewsFrom, credentialFromVaultEntry, streakViewFrom } from './state-mappers';
import type { WfClient } from './wf-client';

const WAGERS_DEMO_ONLY =
  'wager mechanics run in demo mode — switch with the header toggle (→ demo)';

// Deterministic per wallet address — the private-state store and backup key.
export const walletStoreName = (coinPublicKey: string): string =>
  `wf-wallet-${coinPublicKey.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}`;

export class WalletClient implements WfClient {
  readonly mode: DemoMode = 'wallet';

  private connection: WalletConnection | null = null;
  private session: WalletStrideSession | null = null;
  private attestCount = 0;
  private lastVaultKey: Uint8Array | null = null;

  private storeName(): string {
    if (!this.connection) throw new Error('wallet not connected');
    return walletStoreName(this.connection.coinPublicKey);
  }

  async connect(): Promise<ClientSession> {
    const connection = await connectWallet();
    this.connection = connection;
    const bridge = await loadWalletBridge();
    const { loadDeployInfo } = await import('./deploy-info');
    const deploy = await loadDeployInfo();
    await bridge.initializeProviders(connection.api);
    this.session = await bridge.joinStrideFromBrowser(
      connection.api,
      deploy.contractAddress,
      this.storeName()
    );
    return {
      mode: 'wallet',
      athlete: ATHLETE_A,
      walletConnected: true,
      walletLabel: `${connection.name} · ${hexShort(connection.shieldedAddress, 8, 6)}`,
      walletAddress: connection.shieldedAddress,
      networkId: connection.networkId,
    };
  }

  async attest(): Promise<AttestOutcome> {
    const session = this.requireSession();
    const stages = walletStages();
    const mark = (id: string, state: AttestationStage['state']) => {
      for (const s of stages) if (s.id === id) s.state = state;
    };

    const logEntry = ATTESTATION_LOG[this.attestCount % ATTESTATION_LOG.length];
    const fixture = logEntry.fixture as unknown as {
      claim: unknown;
      signatureHex: string;
      attestorAddress: string;
      request?: { url: string; method: string; publicHeaders: Record<string, string> };
      responseText: string;
      proof?: { extractedParameterValues?: Record<string, string> };
    };
    const artifacts = {
      claim: fixture.claim,
      signatureHex: fixture.signatureHex,
      attestorAddress: fixture.attestorAddress,
      request: fixture.request,
      responseText: fixture.responseText,
      extractedParameterValues: fixture.proof?.extractedParameterValues,
    };

    mark('tls', 'active');
    await delay(250);
    mark('tls', 'done');

    mark('notarize', 'active');
    const result = await session.attest(artifacts);
    mark('notarize', 'done');

    mark('chain', 'active');
    await delay(180);
    mark('chain', 'done');
    this.attestCount += 1;
    this.lastVaultKey = result.vaultKey;

    const credential = credentialFromVaultEntry(
      '0x' + Array.from(result.vaultKey).map((b) => b.toString(16).padStart(2, '0')).join(''),
      result.txHash,
      Date.now(),
      result.metrics
    );
    return { credential, stages, replayed: true };
  }

  async vault(): Promise<AttestedCredential[]> {
    const session = this.requireSession();
    const state = await session.readState();
    return state.vault.map((entry) => {
      const key = entry.vaultKey ?? entry.key ?? '';
      const metrics = entry.metrics ?? (entry.metric ? [entry.metric] : []);
      return credentialFromVaultEntry(key, undefined, entry.timestamp, metrics);
    });
  }

  async listWagers(): Promise<WagerView[]> {
    return [];
  }

  async createWager(_req: WagerCreateRequest): Promise<WagerView> {
    throw new Error(WAGERS_DEMO_ONLY);
  }

  async acceptWager(_id: number): Promise<WagerView> {
    throw new Error(WAGERS_DEMO_ONLY);
  }

  async submitWorkout(_id: number, _credentialId: string): Promise<WagerView> {
    throw new Error(WAGERS_DEMO_ONLY);
  }

  async settleWager(_id: number): Promise<WagerSettleResult> {
    throw new Error(WAGERS_DEMO_ONLY);
  }

  async streak(): Promise<StreakView> {
    const session = this.requireSession();
    const state = await session.readState();
    return streakViewFrom(state.streaks, 'wallet:streak');
  }

  async advanceStreak(): Promise<StreakView> {
    const session = this.requireSession();
    const vaultKey = await this.currentVaultKey(session);
    const result = await session.advanceStreak(vaultKey);
    return streakViewFrom(
      { streakCount: result.streakCount, lastDay: result.lastDay },
      'wallet:streak'
    );
  }

  async badges(): Promise<BadgeView[]> {
    const session = this.requireSession();
    const state = await session.readState();
    return badgeViewsFrom(state.badges);
  }

  async mintBadge(badgeId: number): Promise<BadgeView> {
    const session = this.requireSession();
    const vaultKey = await this.currentVaultKey(session);
    const result = await session.mintBadge(badgeId, vaultKey);
    const badge = BADGES.find((b) => b.id === badgeId);
    if (!badge) throw new Error(`unknown badge ${badgeId}`);
    if (!result.minted) throw new Error(`badge ${badgeId} not minted — requirement unmet?`);
    return { ...badge, minted: true, mintedAt: Date.now() };
  }

  async proveBadge(badgeId: number, verifier: string): Promise<BadgeProof> {
    const session = this.requireSession();
    const verifierBinding =
      BigInt(verifier.replace(/0x|[^0-9a-fA-F]/g, '').slice(0, 8)) || 1n;
    const result = await session.proveBadge(badgeId, verifierBinding);
    if (!result.verified) throw new Error(`verification failed for badge ${badgeId}`);
    const badge = BADGES.find((b) => b.id === badgeId);
    return {
      badgeId,
      badgeLabel: badge?.label ?? `badge ${badgeId}`,
      verifier,
      proofId: displayHash(`wallet:proof:${badgeId}:${Date.now()}`),
      verifiedAt: Date.now(),
      statement: `Athlete holds badge "${badge?.label ?? badgeId}" — verified on-chain`,
      dataStillSealed: true,
    };
  }

  async notaryStatus(): Promise<NotaryInfo[]> {
    const healths = await Promise.all([0, 1, 2].map((i) => notaryHealth(i)));
    const { loadDeployInfo } = await import('./deploy-info');
    const deploy = await loadDeployInfo();
    return deploy.notaryKeys.map((key, index) => ({
      index: index as 0 | 1 | 2,
      url: NOTARY_URLS[index],
      keyId: key.id,
      pubkey: `${key.x}${key.y}`,
      healthy: healths[index] !== null,
      lastSeen: healths[index] ? Date.now() : undefined,
      signatureCount: 0,
    }));
  }

  // Backup/resume (wallet mode only) — encrypted export/import of the private
  // state via the bridge; the UI stores the payload in localStorage.
  async backupPrivateState(password: string): Promise<string> {
    const bridge = await loadWalletBridge();
    return bridge.exportPrivateState(password, this.storeName());
  }

  async restorePrivateState(password: string, payload: string): Promise<void> {
    const bridge = await loadWalletBridge();
    await bridge.importPrivateState(password, this.storeName(), payload);
  }

  async resetPrivateState(): Promise<void> {
    const bridge = await loadWalletBridge();
    await bridge.resetPrivateState(this.storeName());
  }

  private requireSession(): WalletStrideSession {
    if (!this.session) {
      throw new Error('wallet not connected — connect first, or switch to demo mode');
    }
    return this.session;
  }

  private async currentVaultKey(session: WalletStrideSession): Promise<Uint8Array> {
    if (this.lastVaultKey) return this.lastVaultKey;
    const state = await session.readState();
    const first = state.vault[0];
    const key = first?.vaultKey ?? first?.key;
    if (!key) throw new Error('no vaulted credential — attest a workout first');
    const bytes = new Uint8Array(32);
    const hex = key.replace(/^0x/, '');
    for (let i = 0; i < 32 && i * 2 < hex.length; i += 1) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
    }
    this.lastVaultKey = bytes;
    return bytes;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const walletStages = (): AttestationStage[] => [
  { id: 'tls', label: 'Replaying attested TLS session', detail: 'pre-recorded via attestor-core (identical crypto path)', state: 'pending' },
  { id: 'notarize', label: 'Notarizing — 2-of-3 collected', detail: 'notaries verify + sign; wallet signs the contract tx', state: 'pending' },
  { id: 'chain', label: 'Submitting via your wallet', detail: 'verifyAttestation → credential vaulted on-chain', state: 'pending' },
];

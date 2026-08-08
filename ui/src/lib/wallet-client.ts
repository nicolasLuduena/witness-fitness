// WALLET-mode implementation of the WfClient contract (Track 0.2 + Round 2D).
// Connects the demo to the contract DIRECTLY through a browser wallet (Lace,
// DApp Connector) — no sidecar identity. The holder secret is deterministic
// per wallet address; the private state persists in the api's browser
// private-state store and can be backed up / restored via the encrypted
// export/import bridge (backup/resume UX on Connect).
//
// Round 2D: attestation is REAL — browser Strava OAuth (stateless service
// :8200 performs the token exchange; the client secret never exists in the
// browser), empty-account guard, live attestation via the attestor + notary
// fan-out + wallet-signed verifyAttestation. Wagers are REAL on-chain duels
// between two browsers: challenge by holder-binding ID, sealed submissions
// with a deterministic submissionRand, and settle via the stateless opening
// relay (each side posts its (value, rand); the settler stages both into its
// private state wagerOpenings and settles).

import type { DemoMode } from '../config';
import { NETWORK_ID, NOTARY_URLS } from '../config';
import type {
  Athlete,
  AttestedCredential,
  AttestOutcome,
  AttestationStage,
  BadgeProof,
  BadgeView,
  ClientSession,
  NotaryInfo,
  StreakView,
  WagerCreateRequest,
  WagerResult,
  WagerSettleResult,
  WagerStatus,
  WagerSubmission,
  WagerView,
} from '../domain/types';
import { metricById } from '../domain/types';
import { ATHLETE_A, BADGES } from '../domain/story';
import { displayHash, hexShort } from './format';
import { notaryHealth } from './notary-api';
import { connectWallet, type WalletConnection } from './wallet-connector';
import {
  loadWalletBridge,
  type WalletAttestResult,
  type WalletMetric,
  type WalletStrideSession,
  type WalletWagerRouting,
  type WalletWagerView,
} from './wallet-bridge';
import { badgeViewsFrom, credentialFromVaultEntry, streakViewFrom } from './state-mappers';
import type { WfClient } from './wf-client';
import { attestStrava, proofToNotaryArtifacts } from './attest/attest-browser';
import { athleteIdentityFromExchange, type AthleteIdentity } from './attest/identity';
import {
  buildAuthUrl,
  emptyAccountGuard,
  exchangeCode,
  getValidAccessToken,
  localStorageTokenStore,
  parseAuthCallback,
} from './attest/strava';
import {
  OPENING_RELAY_TIMEOUT,
  hexOf as hexOfBigint,
  postWagerOpening,
  waitForBothOpenings,
} from './wager-relay';

// Typed flow error the UI can branch on (Strava panel states).
export class StravaFlowError extends Error {
  constructor(
    readonly code: 'strava-auth-required' | 'no-activities' | 'strava-api',
    message: string
  ) {
    super(message);
    this.name = 'StravaFlowError';
  }
}

interface AttestationRecord {
  attestation: WalletAttestResult['attestation'];
  metrics: WalletMetric[];
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Deterministic per wallet address — the private-state store and backup key.
export const walletStoreName = (coinPublicKey: string): string =>
  `wf-wallet-${coinPublicKey.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}`;

const bytesToBigInt = (bytes: Uint8Array): bigint => {
  let value = 0n;
  for (const b of bytes) {
    value = (value << 8n) | BigInt(b);
  }
  return value;
};

const hexOf = (bytes: Uint8Array): string =>
  '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

// The contract's Field is ~253 bits; keep the rand well inside it.
const FIELD_SAFE_MASK = (1n << 248n) - 1n;

const parseHolderBinding = (input: string): bigint => {
  const hex = input.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('challenge ID must be the opponent\u2019s 64-hex holder binding (0x…, 32 bytes)');
  }
  return BigInt('0x' + hex);
};

const syntheticAthlete = (holderBinding: string, role: Athlete['role']): Athlete => ({
  name: `Athlete ${hexShort(holderBinding, 8, 6)}`,
  handle: hexShort(holderBinding, 8, 6),
  role,
  holderBinding,
});

const bigintToHex = (value: bigint): string => '0x' + value.toString(16);

export class WalletClient implements WfClient {
  readonly mode: DemoMode = 'wallet';

  // Test seam: inject a bridge (the stub) instead of loading the real api
  // module. Production code always uses loadWalletBridge().
  constructor(private readonly bridgeOverride?: import('./wallet-bridge').WalletBridge) {}

  private async bridge(): Promise<import('./wallet-bridge').WalletBridge> {
    return this.bridgeOverride ?? (await loadWalletBridge());
  }

  private connection: WalletConnection | null = null;
  private session: WalletStrideSession | null = null;
  private stravaIdentity: AthleteIdentity | null = null;
  private lastVaultKey: Uint8Array | null = null;

  // Per-credential notarized attestations (needed to re-stage at submit time
  // — the private state holds only the LATEST assertion).
  private attestations = new Map<string, AttestationRecord>();
  private shortIdIndex = new Map<string, string>();

  // My remembered (value, rand) opening per wager + the last settle's
  // openings (for the reveal). Session-only — NOT part of the backup.
  private openings = new Map<number, { value: bigint; rand: bigint }>();
  private lastOpenings = new Map<number, { challenger: { value: bigint; rand: bigint }; opponent: { value: bigint; rand: bigint } }>();

  private storeName(): string {
    if (!this.connection) throw new Error('wallet not connected');
    return walletStoreName(this.connection.coinPublicKey);
  }

  private requireConnection(): WalletConnection {
    if (!this.connection) throw new Error('wallet not connected');
    return this.connection;
  }

  private requireSession(): WalletStrideSession {
    if (!this.session) {
      throw new Error('wallet not connected — connect first');
    }
    return this.session;
  }

  private readStravaIdentity(): AthleteIdentity | null {
    const tokens = localStorageTokenStore.load();
    return tokens?.athlete ? athleteIdentityFromExchange(tokens) : null;
  }

  private stravaAthlete(): Athlete {
    const identity = this.stravaIdentity ?? this.readStravaIdentity();
    const binding = this.session?.holderBinding ?? ATHLETE_A.holderBinding;
    if (identity) {
      return {
        name: identity.name,
        handle: `strava:${identity.stravaId}`,
        role: 'local',
        holderBinding: binding,
      };
    }
    return {
      name: 'Wallet athlete',
      handle: hexShort(this.connection?.coinPublicKey ?? '0x00', 6, 4),
      role: 'local',
      holderBinding: binding,
    };
  }

  async connect(): Promise<ClientSession> {
    const connection = await connectWallet();
    this.connection = connection;
    const bridge = await this.bridge();
    const { loadDeployInfo } = await import('./deploy-info');
    const deploy = await loadDeployInfo();
    await bridge.initializeProviders(connection.api);
    this.session = await bridge.joinStrideFromBrowser(
      connection.api,
      deploy.contractAddress,
      this.storeName()
    );
    this.stravaIdentity = this.readStravaIdentity();
    return {
      mode: 'wallet',
      athlete: this.stravaAthlete(),
      walletConnected: true,
      walletLabel: `${connection.name} · ${hexShort(connection.shieldedAddress, 8, 6)}`,
      walletAddress: connection.shieldedAddress,
      networkId: connection.networkId,
    };
  }

  // ------------------------------------------------------------ Strava -----

  stravaStatus(): { connected: boolean; athleteName?: string; stravaId?: number } {
    const identity = this.stravaIdentity ?? this.readStravaIdentity();
    if (!identity) return { connected: false };
    return { connected: true, athleteName: identity.name, stravaId: identity.stravaId };
  }

  // Opens the Strava authorize page (same tab). The redirect lands on
  // `<origin>/strava/callback?code=…`; handleStravaRedirect() exchanges it.
  connectStrava(): void {
    window.location.href = buildAuthUrl();
  }

  // Called on app load: if the URL carries a Strava callback code, exchange
  // it through the stateless service, persist the tokens, clean the URL.
  async handleStravaRedirect(): Promise<boolean> {
    const callback = parseAuthCallback(window.location.href);
    if (!callback.code) return false;
    const tokens = await exchangeCode(callback.code);
    localStorageTokenStore.save(tokens);
    this.stravaIdentity = this.readStravaIdentity();
    window.history.replaceState({}, '', window.location.origin);
    return true;
  }

  // ----------------------------------------------------------- attest -----

  async attest(): Promise<AttestOutcome> {
    const session = this.requireSession();
    const stages = walletStages();
    const mark = (id: string, state: AttestationStage['state']) => {
      for (const s of stages) if (s.id === id) s.state = state;
    };

    let token: string;
    try {
      token = await getValidAccessToken();
    } catch {
      throw new StravaFlowError(
        'strava-auth-required',
        'No Strava account connected — connect Strava first (the client secret never touches this browser)'
      );
    }

    mark('guard', 'active');
    const guard = await emptyAccountGuard(token);
    mark('guard', 'done');
    if (!guard.canInteract) {
      throw new StravaFlowError(
        'no-activities',
        'Strava account has no activities yet — upload a real workout on Strava, then retry'
      );
    }

    mark('tls', 'active');
    const result = await attestStrava(token).catch((err) => {
      throw new StravaFlowError(
        'strava-api',
        `attestation failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });
    const artifacts = proofToNotaryArtifacts(result);
    mark('tls', 'done');

    mark('notarize', 'active');
    const attested = await session.attest(artifacts);
    mark('notarize', 'done');

    mark('chain', 'active');
    await delay(180);
    mark('chain', 'done');
    this.lastVaultKey = attested.vaultKey;
    this.rememberAttestation(attested);

    return { credential: this.credentialFrom(attested), stages, replayed: false };
  }

  private rememberAttestation(attested: WalletAttestResult): void {
    const key = hexOf(attested.vaultKey);
    const shortId = hexShort(key, 12, 8);
    this.attestations.set(key, { attestation: attested.attestation, metrics: attested.metrics });
    this.shortIdIndex.set(shortId, key);
  }

  private attestationFor(credentialId: string): AttestationRecord | undefined {
    const isFullKey = /^0x[0-9a-f]{64}$/.test(credentialId);
    const key = isFullKey ? credentialId : this.shortIdIndex.get(credentialId);
    if (!key) return undefined;
    return this.attestations.get(key);
  }

  private credentialFrom(attested: WalletAttestResult): AttestedCredential {
    const key = hexOf(attested.vaultKey);
    const base = credentialFromVaultEntry(key, attested.txHash, Date.now(), attested.metrics);
    return {
      ...base,
      athlete: this.stravaAthlete(),
      source: 'live-session',
      notarySignatures: 2,
    };
  }

  async vault(): Promise<AttestedCredential[]> {
    const session = this.requireSession();
    const state = await session.readState();
    const mine = this.stravaAthlete();
    return state.vault.map((entry) => {
      const key = entry.vaultKey ?? entry.key ?? '';
      const metrics = entry.metrics ?? (entry.metric ? [entry.metric] : []);
      const credential = credentialFromVaultEntry(key, undefined, entry.timestamp, metrics);
      return { ...credential, athlete: mine, source: 'live-session' };
    });
  }

  // ----------------------------------------------------------- wagers -----

  async listWagers(): Promise<WagerView[]> {
    const session = this.requireSession();
    const wagers = await session.listWagers();
    return wagers.map((w) => this.wagerView(w));
  }

  async createWager(req: WagerCreateRequest): Promise<WagerView> {
    const session = this.requireSession();
    const opponentBinding = parseHolderBinding(req.opponent.holderBinding);
    const routing = await this.myRouting();
    await session.createWager({
      opponentBinding,
      metricId: req.metricId,
      stake: BigInt(Math.round(req.stake * 1_000_000_000_000)),
      deadlineBlock: req.deadlineBlock,
      routing,
    });
    const all = await this.listWagers();
    const created = all[all.length - 1];
    if (!created) throw new Error('wager create failed');
    return created;
  }

  async acceptWager(id: number): Promise<WagerView> {
    const session = this.requireSession();
    const routing = await this.myRouting();
    await session.acceptWager(BigInt(id), routing);
    const view = (await this.listWagers()).find((w) => w.id === id);
    if (!view) throw new Error(`wager ${id} not found`);
    return view;
  }

  // Submits MY sealed submission: a fresh deterministic submissionRand is
  // staged into the private state (the contract seals transientCommit(value,
  // submissionRand) from it), and my (value, rand) opening is remembered for
  // the relay at settle time.
  async submitWorkout(id: number, credentialId: string): Promise<WagerView> {
    const session = this.requireSession();
    const record = this.attestationFor(credentialId);
    if (!record) {
      throw new Error('credential not found — attest a workout first');
    }
    const wagers = await session.listWagers();
    const wager = wagers.find((w) => Number(w.id) === id);
    if (!wager) throw new Error(`unknown wager ${id}`);
    const value = this.claimValueFor(record, wager.metricId);
    const rand = this.freshSubmissionRand();
    await session.stageSubmissionRand(rand);
    await session.submitWorkout(BigInt(id), record.attestation, value);
    this.openings.set(id, { value, rand });
    // Relay MY opening immediately (the contract seals transientCommit(value,
    // rand)); the settler (either side) polls until both are present.
    const mySide = wager.challenger === BigInt(session.holderBinding) ? 'A' : 'B';
    await postWagerOpening(id, mySide, value, rand).catch((err) => {
      throw new Error(
        `submission sealed on-chain but the opening relay failed: ${err instanceof Error ? err.message : String(err)} — retry settle later`
      );
    });
    const view = (await this.listWagers()).find((w) => w.id === id);
    if (!view) throw new Error(`wager ${id} not found`);
    return view;
  }

  // Settle: ensure MY opening is on the relay, poll until BOTH are present,
  // stage [challenger, opponent] into private-state wagerOpenings (order is
  // contract law: challenger first), then settleWager on-chain.
  async settleWager(id: number): Promise<WagerSettleResult> {
    const session = this.requireSession();
    const wagers = await session.listWagers();
    const wager = wagers.find((w) => Number(w.id) === id);
    if (!wager) throw new Error(`unknown wager ${id}`);
    const myOpening = this.openings.get(id);
    if (!myOpening) {
      throw new Error('no recorded opening for this wager — submit your workout first');
    }
    const mySide = wager.challenger === BigInt(session.holderBinding) ? 'A' : 'B';
    await postWagerOpening(id, mySide, myOpening.value, myOpening.rand);

    const relayed = await waitForBothOpenings(id, { timeoutMs: OPENING_RELAY_TIMEOUT.ms });
    const openings = {
      challenger: { value: BigInt(relayed.challenger.value), rand: BigInt(relayed.challenger.rand) },
      opponent: { value: BigInt(relayed.opponent.value), rand: BigInt(relayed.opponent.rand) },
    };
    const mineRelayed =
      (relayed.challenger.rand === hexOfBigint(myOpening.rand) &&
        relayed.challenger.value === hexOfBigint(myOpening.value)) ||
      (relayed.opponent.rand === hexOfBigint(myOpening.rand) &&
        relayed.opponent.value === hexOfBigint(myOpening.value));
    if (!mineRelayed) {
      throw new Error('the relayed openings do not include your submission — retry settle');
    }

    await session.settleWager(BigInt(id), openings);
    this.lastOpenings.set(id, openings);
    const view = (await this.listWagers()).find((w) => w.id === id);
    if (!view) throw new Error(`wager ${id} not found`);
    return {
      wager: view,
      reveal: {
        sealedForRoom: true,
        comparison: {
          challengerValue: Number(openings.challenger.value),
          opponentValue: Number(openings.opponent.value),
        },
      },
    };
  }

  private claimValueFor(record: AttestationRecord, metricId: bigint): bigint {
    const claims = (
      record.attestation.assertion as { claims?: { metricId: bigint; value: bigint }[] }
    ).claims;
    const claim = (claims ?? []).find((c) => c.metricId === metricId);
    if (!claim) {
      throw new Error(`attestation has no claim for metric ${metricId} — attest a workout that includes it`);
    }
    return claim.value;
  }

  private freshSubmissionRand(): bigint {
    return bytesToBigInt(crypto.getRandomValues(new Uint8Array(32))) & FIELD_SAFE_MASK;
  }

  private async myRouting(): Promise<WalletWagerRouting> {
    const connection = this.requireConnection();
    const { unshieldedAddress } = await connection.api.getUnshieldedAddress();
    const { MidnightBech32m, UnshieldedAddress } = await import('@midnight-ntwrk/wallet-sdk-address-format');
    // The wallet hands us a bech32m STRING; the codec decodes parsed instances.
    const decoded = UnshieldedAddress.codec.decode(
      NETWORK_ID,
      MidnightBech32m.parse(unshieldedAddress)
    );
    // hexString relies on Buffer#toString('hex') (Node-only — the browser's
    // Uint8Array would render comma-joined). Convert the raw bytes ourselves.
    const bytes = decoded.data as Uint8Array;
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const { encodeUserAddress } = await import('@midnight-ntwrk/ledger-v8');
    const payout = encodeUserAddress(hex);
    const coinKey = { bytes: await this.coinKeyBytes() };
    return { payout, coinKey };
  }

  // The DApp Connector's shieldedCoinPublicKey is bech32m per the API doc
  // (the wallet SDK's CoinPublicKey is hex — Lace has shipped both over time);
  // accept either form defensively.
  private async coinKeyBytes(): Promise<Uint8Array> {
    const cpk = this.requireConnection().coinPublicKey;
    const bare = cpk.replace(/^0x/, '');
    if (/^[0-9a-fA-F]{64}$/.test(bare)) {
      const out = new Uint8Array(32);
      for (let i = 0; i < 32; i += 1) {
        out[i] = Number.parseInt(bare.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    const { MidnightBech32m, ShieldedCoinPublicKey } = await import('@midnight-ntwrk/wallet-sdk-address-format');
    return (ShieldedCoinPublicKey.codec.decode(
      NETWORK_ID,
      MidnightBech32m.parse(cpk)
    ).data as Uint8Array).slice();
  }

  private wagerView(w: WalletWagerView): WagerView {
    const myBinding = this.session?.holderBinding ?? '';
    const myBig = myBinding ? BigInt(myBinding) : null;
    const amChallenger = myBig !== null && w.challenger === myBig;
    const mine = this.stravaAthlete();
    const challengerHex = bigintToHex(w.challenger);
    const opponentHex = bigintToHex(w.opponent);
    const challenger: Athlete = amChallenger ? mine : syntheticAthlete(challengerHex, 'opponent');
    const opponent: Athlete = !amChallenger ? mine : syntheticAthlete(opponentHex, 'opponent');

    const status: WagerStatus = w.settled
      ? 'settled'
      : !w.accepted
        ? 'open'
        : w.challengerSubmission.is_some && w.opponentSubmission.is_some
          ? 'submitted'
          : 'accepted';

    const submissions: WagerSubmission[] = [];
    if (w.challengerSubmission.is_some) {
      submissions.push({
        athlete: challenger,
        sealed: true,
        commitment: hexShort(bigintToHex(w.challengerSubmission.value), 10, 8),
      });
    }
    if (w.opponentSubmission.is_some) {
      submissions.push({
        athlete: opponent,
        sealed: true,
        commitment: hexShort(bigintToHex(w.opponentSubmission.value), 10, 8),
      });
    }

    const stakeNIGHT = Number(w.stake) / 1_000_000_000_000;
    let result: WagerResult | undefined;
    if (w.settled) {
      result = this.settleResult(w, challenger, opponent, stakeNIGHT);
    }

    return {
      id: Number(w.id),
      title: `${metricById(w.metricId).label} duel`,
      metric: metricById(w.metricId),
      stake: stakeNIGHT,
      deadlineBlock: w.deadlineBlock,
      createdAt: Date.now(),
      status,
      challenger,
      opponent,
      submissions,
      result,
    };
  }

  private settleResult(
    w: WalletWagerView,
    challenger: Athlete,
    opponent: Athlete,
    stakeNIGHT: number
  ): WagerResult {
    const openings = this.lastOpenings.get(Number(w.id));
    const challengerValue = openings
      ? Number(openings.challenger.value)
      : w.challengerSubmission.is_some
        ? Number(w.challengerSubmission.value)
        : undefined;
    const opponentValue = openings
      ? Number(openings.opponent.value)
      : w.opponentSubmission.is_some
        ? Number(w.opponentSubmission.value)
        : undefined;
    const pot = stakeNIGHT * 2;
    const forfeit = !(challengerValue !== undefined && opponentValue !== undefined);
    const tie = !forfeit && challengerValue === opponentValue;
    let winner: Athlete | undefined;
    if (forfeit) {
      winner = challengerValue !== undefined ? challenger : opponentValue !== undefined ? opponent : undefined;
    } else if (!tie) {
      winner = (challengerValue ?? 0) > (opponentValue ?? 0) ? challenger : opponent;
    }
    const disclosed = openings !== undefined;
    return {
      winner,
      tie,
      forfeit,
      pot,
      currency: 'NIGHT',
      disclosed,
      challengerValue,
      opponentValue,
      nft: undefined, // the winner NFT mints to the winner's coin key — not observable from the wallet's contract view
      summary: forfeit
        ? `${winner?.name ?? 'The submitter'} wins ${pot} NIGHT by forfeit`
        : tie
          ? `Tie — both stakes refunded (${pot} NIGHT pot)`
          : `${winner?.name} wins ${pot} NIGHT — sealed comparison disclosed`,
    };
  }

  // ------------------------------------------------- streak / badge --------

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
    const bridge = await this.bridge();
    return bridge.exportPrivateState(password, this.storeName());
  }

  async restorePrivateState(password: string, payload: string): Promise<void> {
    const bridge = await this.bridge();
    await bridge.importPrivateState(password, this.storeName(), payload);
  }

  async resetPrivateState(): Promise<void> {
    const bridge = await this.bridge();
    await bridge.resetPrivateState(this.storeName());
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

const walletStages = (): AttestationStage[] => [
  { id: 'guard', label: 'Strava account check', detail: 'real API check — no fabricated data', state: 'pending' },
  { id: 'tls', label: 'Witnessing TLS session', detail: 'attestor-core tunnels to www.strava.com; stwo ZK proof generated', state: 'pending' },
  { id: 'notarize', label: 'Notarizing — 2-of-3 collected', detail: 'notaries verify + sign; wallet signs the contract tx', state: 'pending' },
  { id: 'chain', label: 'Submitting via your wallet', detail: 'verifyAttestation → credential vaulted on-chain', state: 'pending' },
];

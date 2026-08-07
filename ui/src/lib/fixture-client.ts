// Fixture-mode implementation of the WfClient contract. Offline, deterministic,
// and shaped exactly like live responses. The demo story lives in story.ts;
// this client runs the same pipeline the live path runs: staged attestation →
// notarization (2-of-3) → vault; sealed wager lifecycle; sealed streak chain →
// badge → proveBadge.

import type { DemoMode } from '../config';
import { displayHash } from './format';
import { metricById, type AttestationStage, type Athlete } from '../domain/types';
import type {
  AttestOutcome,
  AttestedCredential,
  BadgeProof,
  BadgeView,
  ClientSession,
  NotaryInfo,
  StreakDay,
  StreakView,
  WagerCreateRequest,
  WagerSettleResult,
  WagerSubmission,
  WagerView,
} from '../domain/types';
import {
  ATHLETE_A,
  ATHLETE_B,
  BADGES,
  EMPLOYER,
  NOW_MS,
  OPPONENT_WORKOUT,
  REAL_WALK_DISTANCES_M,
  SEEDED_WAGER,
  STORY_VAULT,
  fakeCommitment,
} from '../domain/story';
import type { WfClient } from './wf-client';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FixtureClient implements WfClient {
  readonly mode: DemoMode = 'fixture';

  private vaultCreds: AttestedCredential[] = [];
  private wagers: WagerView[] = [];
  private nextWagerId = 2;
  private streakView: StreakView;
  private badgeList: BadgeView[];
  private notarySigCount: [number, number, number] = [0, 0, 0];
  private opponentAutoSubmitTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.streakView = {
      current: 2,
      lastDay: BigInt(dayIndex(NOW_MS() - 86_400_000)),
      days: seedDays(),
      chainId: displayHash('streak-chain:v1'),
    };
    this.badgeList = BADGES.map((b) => ({ ...b }));
    this.wagers = [this.seedOpenWager()];
    this.vaultCreds = STORY_VAULT.map((c) => this.toCredential(c.athlete, c.metricId, c.value, c.daysAgo, c.source, c.notarySignatures));
  }

  async connect(): Promise<ClientSession> {
    return {
      mode: 'fixture',
      athlete: ATHLETE_A,
      walletConnected: false,
      walletLabel: 'demo identity (no wallet needed)',
    };
  }

  async attest(): Promise<AttestOutcome> {
    const stages = attestationStages();
    const setActive = (id: string) => {
      for (const s of stages) s.state = s.id === id ? 'active' : s.state === 'done' ? 'done' : 'pending';
    };
    const markDone = (id: string) => {
      for (const s of stages) if (s.id === id) s.state = 'done';
    };

    setActive('tls');
    await delay(420);
    markDone('tls');
    setActive('proof');
    await delay(380);
    markDone('proof');
    setActive('notarize');
    await delay(300);
    this.notarySigCount[0] += 1;
    this.notarySigCount[1] += 1;
    markDone('notarize');
    setActive('chain');
    await delay(260);
    markDone('chain');

    const credential = this.toCredential(
      ATHLETE_A,
      1n,
      REAL_WALK_DISTANCES_M[this.vaultCreds.length % REAL_WALK_DISTANCES_M.length],
      0,
      'fixture-replay',
      2
    );
    this.vaultCreds = [credential, ...this.vaultCreds];
    return {
      credential,
      stages,
      replayed: true,
    };
  }

  async vault(): Promise<AttestedCredential[]> {
    return [...this.vaultCreds];
  }

  async listWagers(): Promise<WagerView[]> {
    return [...this.wagers];
  }

  async createWager(req: WagerCreateRequest): Promise<WagerView> {
    const wager: WagerView = {
      id: this.nextWagerId++,
      title: `${ATHLETE_A.handle} vs ${req.opponent.handle} — ${metricById(req.metricId).label.toLowerCase()} duel`,
      metric: metricById(req.metricId),
      stake: req.stake,
      deadlineBlock: req.deadlineBlock,
      createdAt: NOW_MS(),
      status: 'open',
      challenger: ATHLETE_A,
      opponent: req.opponent,
      submissions: [],
    };
    this.wagers = [wager, ...this.wagers];
    return wager;
  }

  async acceptWager(id: number): Promise<WagerView> {
    const wager = this.mustGet(id);
    wager.status = 'accepted';
    wager.deadlineBlock = wager.deadlineBlock + 6n;
    return { ...wager };
  }

  async submitWorkout(id: number, credentialId: string): Promise<WagerView> {
    const wager = this.mustGet(id);
    const credential = this.vaultCreds.find((c) => c.id === credentialId);
    if (!credential) throw new Error(`credential ${credentialId} not in vault`);
    if (credential.metric.id !== wager.metric.id) {
      throw new Error(`credential metric ${credential.metric.label} does not match wager metric`);
    }
    const localSubmission: WagerSubmission = {
      athlete: ATHLETE_A,
      sealed: true,
      commitment: fakeCommitment(`wager:${id}:ava`),
      value: credential.value,
    };
    wager.submissions = [localSubmission];
    wager.status = 'submitted';
    void this.scheduleOpponentSubmission(wager);
    return { ...wager };
  }

  async settleWager(id: number): Promise<WagerSettleResult> {
    const wager = this.mustGet(id);
    if (wager.status !== 'submitted') {
      throw new Error('wager not ready to settle — both submissions must be sealed');
    }
    const challenger = wager.submissions.find((s) => s.athlete.role === 'local');
    const opponent = wager.submissions.find((s) => s.athlete.role !== 'local');
    const pot = wager.stake * 2;

    let winner: Athlete | undefined;
    let tie = false;
    let forfeit = false;
    let summary: string;

    if (!challenger?.value || !opponent?.value) {
      forfeit = true;
      winner = challenger?.value ? ATHLETE_A : opponent?.value ? wager.opponent : undefined;
      summary = forfeit && winner ? `${winner.name} wins by forfeit` : 'wager void — no valid submissions';
    } else if (challenger.value === opponent.value) {
      tie = true;
      summary = 'Dead heat — stakes returned';
    } else {
      winner = challenger.value > opponent.value ? ATHLETE_A : wager.opponent;
      summary = `${winner.name} wins — the losing number stays sealed`;
    }

    wager.status = 'settled';
    wager.result = {
      winner,
      tie,
      forfeit,
      pot,
      currency: 'tNIGHT',
      disclosed: true,
      challengerValue: challenger?.value,
      opponentValue: opponent?.value,
      summary,
    };

    return {
      wager: { ...wager },
      reveal: {
        sealedForRoom: true, // the ledger never published the losing input
        comparison: challenger?.value && opponent?.value
          ? { challengerValue: challenger.value, opponentValue: opponent.value }
          : undefined,
      },
    };
  }

  async streak(): Promise<StreakView> {
    return { ...this.streakView, days: [...this.streakView.days] };
  }

  async advanceStreak(): Promise<StreakView> {
    const today = dayIndex(NOW_MS());
    if (this.streakView.days.some((d) => d.day === today && d.sealed)) {
      return this.streak();
    }
    const sealedDay: StreakDay = { day: today, sealed: true, label: 'TODAY', active: true };
    const prev = [...this.streakView.days].filter((d) => !d.active);
    this.streakView = {
      current: this.streakView.current + 1,
      lastDay: BigInt(today),
      days: [...prev, sealedDay],
      chainId: displayHash(`streak-chain:${this.streakView.current + 1}`),
    };
    return this.streak();
  }

  async badges(): Promise<BadgeView[]> {
    return this.badgeList.map((b) => ({ ...b }));
  }

  async mintBadge(badgeId: number): Promise<BadgeView> {
    const badge = this.badgeList.find((b) => b.id === badgeId);
    if (!badge) throw new Error(`unknown badge ${badgeId}`);
    if (badge.minted) return { ...badge };
    if (badgeId === 1 && this.streakView.current < 3) {
      throw new Error('streak badge requires a 3-day attested chain');
    }
    if (badgeId === 2 && !this.vaultCreds.some((c) => c.metric.id === 1n && c.value >= 10_000)) {
      throw new Error('centurion badge requires an attested distance ≥ 10 km');
    }
    badge.minted = true;
    badge.mintedAt = NOW_MS();
    badge.count = badgeId === 1 ? this.streakView.current : undefined;
    this.notarySigCount[1] += 1;
    this.notarySigCount[2] += 1;
    return { ...badge };
  }

  async proveBadge(badgeId: number, verifier: string): Promise<BadgeProof> {
    const badge = this.badgeList.find((b) => b.id === badgeId);
    if (!badge || !badge.minted) {
      throw new Error('badge not minted — nothing to prove');
    }
    return {
      badgeId,
      badgeLabel: badge.label,
      verifier,
      proofId: displayHash(`proveBadge:${badgeId}:${verifier}`),
      verifiedAt: NOW_MS(),
      statement: `Athlete holds badge "${badge.label}" — ${badge.requirement.toLowerCase()}`,
      dataStillSealed: true,
    };
  }

  async notaryStatus(): Promise<NotaryInfo[]> {
    const { loadDeployInfo } = await import('./deploy-info');
    const deploy = await loadDeployInfo();
    return deploy.notaryKeys.map((key, index) => ({
      index: index as 0 | 1 | 2,
      url: `http://127.0.0.1:${8101 + index}`,
      keyId: key.id,
      pubkey: `${key.x}${key.y}`,
      healthy: true,
      lastSeen: NOW_MS(),
      signatureCount: this.notarySigCount[index],
    }));
  }

  private toCredential(
    athlete: Athlete,
    metricId: bigint,
    value: number,
    daysAgo: number,
    source: AttestedCredential['source'],
    notarySignatures: number
  ): AttestedCredential {
    const metric = metricById(metricId);
    const seed = `vault:${athlete.handle}:${metricId}:${value}:${daysAgo}`;
    return {
      id: fakeCommitment(seed),
      athlete,
      source,
      metric,
      value,
      commitment: fakeCommitment(seed + ':commit'),
      timestamp: NOW_MS() - daysAgo * 86_400_000,
      provableChips: [metric.provableChip(value)],
      notarySignatures,
      assertionId: displayHash(seed + ':assertion'),
    };
  }

  private seedOpenWager(): WagerView {
    const metric = metricById(SEEDED_WAGER.metricId);
    return {
      id: SEEDED_WAGER.id,
      title: SEEDED_WAGER.title,
      metric,
      stake: SEEDED_WAGER.stake,
      deadlineBlock: BigInt(1_500_500),
      createdAt: NOW_MS() - 2 * 60_000,
      status: 'open',
      challenger: ATHLETE_A,
      opponent: ATHLETE_B,
      submissions: [],
    };
  }

  private mustGet(id: number): WagerView {
    const wager = this.wagers.find((w) => w.id === id);
    if (!wager) throw new Error(`wager ${id} not found`);
    return wager;
  }

  private scheduleOpponentSubmission(wager: WagerView): void {
    if (this.opponentAutoSubmitTimer !== undefined) return;
    this.opponentAutoSubmitTimer = globalThis.setTimeout(() => {
      this.opponentAutoSubmitTimer = undefined;
      const current = this.wagers.find((w) => w.id === wager.id);
      if (!current || current.status !== 'submitted') return;
      current.submissions = [
        ...current.submissions,
        {
          athlete: OPPONENT_WORKOUT.athlete,
          sealed: true,
          commitment: fakeCommitment(`wager:${wager.id}:milo`),
          value: OPPONENT_WORKOUT.value,
        },
      ];
    }, 1_400);
  }
}

const dayIndex = (epochMs: number): number => Math.floor(epochMs / 86_400_000);

const seedDays = (): StreakDay[] => {
  const today = dayIndex(NOW_MS());
  return [
    { day: today - 2, sealed: true, label: '-2', active: false },
    { day: today - 1, sealed: true, label: '-1', active: false },
    { day: today, sealed: false, label: 'TODAY', active: true },
  ];
};

const attestationStages = (): AttestationStage[] => [
  { id: 'tls', label: 'Witnessing TLS session', detail: 'attestor-core tunnels to www.strava.com', state: 'pending' },
  { id: 'proof', label: 'ZK proof generated', detail: 'extracted parameters committed, no plaintext leaves the client', state: 'pending' },
  { id: 'notarize', label: 'Notarizing — 2 of 3 keys', detail: 'independent verification + Jubjub-Schnorr signing', state: 'pending' },
  { id: 'chain', label: 'Vaulting on-chain', detail: 'persistentCommit stored, holder binding attached', state: 'pending' },
];

// Re-export for the employer panel's "mock verifier" identity.
export { EMPLOYER };

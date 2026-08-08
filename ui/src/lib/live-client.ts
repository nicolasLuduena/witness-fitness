// LIVE-mode implementation of the WfClient contract, delegating to the demo
// sidecar on :8200 (packages/api). The sidecar owns every on-chain concern:
// notary signature collection (2-of-3), contract submit, private state.
// The browser performs typed fetch calls only — no Lace wallet required.
//
// Demo truth: the TLS capture is pre-recorded (Strava fixtures pending the
// human OAuth step; the two public-API fixtures are offline-verified). The
// crypto after that point is REAL: notary verification + signing, on-chain
// verification, vaulting — all performed by the sidecar. The UI labels this
// "replaying attested session".
//
// Wagers are LIVE (Phase C): the sidecar holds both demo identities (A = seed
// ONE, B = seed TWO) with real unshielded NIGHT stakes and a shielded
// WitnessFitness NFT to the winner. The UI drives both athletes' submissions
// (two explicit buttons) and settles under seal.

import type { DemoMode } from "../config";
import { NOTARY_URLS, SIDECAR_URL } from "../config";
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
  WagerSubmission,
  WagerView,
} from "../domain/types";
import { ATHLETE_A, ATHLETE_B, ATTESTATION_LOG, BADGES } from "../domain/story";
import { displayHash, hexShort } from "./format";
import { notaryHealth } from "./notary-api";
import {
  joinSidecar,
  toNumber,
  type ArtifactsPayload,
  type SidecarHandle,
  type SidecarWagerEntry,
} from "./chain";
import type { WfClient } from "./wf-client";
import { badgeViewsFrom, credentialFromVaultEntry, streakViewFrom } from "./state-mappers";
import { metricById } from "../domain/types";

// NIGHT base units on the devnet (api scripts convention: NIGHT = 10^12).
const NIGHT_BASE = 10n ** 12n;
export const hexOf = (value: bigint): string => "0x" + value.toString(16);

export const athleteLetter = (athlete: Athlete): "A" | "B" =>
  athlete.role === "local" ? "A" : "B";

export const nightToDisplay = (base: number): number => base / Number(NIGHT_BASE);

export class LiveClient implements WfClient {
  readonly mode: DemoMode = "live";

  private sidecar: SidecarHandle | null = null;
  private attestCount = 0;
  private lastVaultKey: string | null = null;

  async connect(_rdns?: string): Promise<ClientSession> {
    const sidecar = await joinSidecar(SIDECAR_URL);
    this.sidecar = sidecar;
    return {
      mode: "live",
      athlete: ATHLETE_A,
      walletConnected: false,
      walletLabel: `demo sidecar · contract ${hexShort(sidecar.contractAddress, 10, 6)}`,
    };
  }

  async attest(): Promise<AttestOutcome> {
    if (!this.sidecar) throw new Error("live client not connected — start the sidecar first");
    const stages = liveStages();
    const mark = (id: string, state: AttestationStage["state"]) => {
      for (const s of stages) if (s.id === id) s.state = state;
    };

    // Round 1B: no pre-recorded proof artifacts live in the UI anymore — the
    // attest workstream's flow (ui/src/lib/attest/*) replaces this replay.
    const logEntry = ATTESTATION_LOG[this.attestCount % ATTESTATION_LOG.length];
    if (!logEntry) {
      throw new Error(
        "live debug mode has no attestation source — use wallet mode for attestations",
      );
    }
    const fixture = logEntry.fixture as unknown as {
      claim: unknown;
      signatureHex: string;
      attestorAddress: string;
      request?: { url: string; method: string; publicHeaders: Record<string, string> };
      responseText: string;
      proof?: { extractedParameterValues?: Record<string, string> };
    };

    const artifacts: ArtifactsPayload = {
      claim: fixture.claim,
      signatureHex: fixture.signatureHex,
      attestorAddress: fixture.attestorAddress,
      request: fixture.request,
      responseText: fixture.responseText,
      extractedParameterValues: fixture.proof?.extractedParameterValues,
    };

    mark("tls", "active");
    await delay(250);
    mark("tls", "done");

    mark("notarize", "active");
    const result = await this.sidecar.attest(artifacts);
    mark("notarize", "done");

    mark("chain", "active");
    await delay(180);
    mark("chain", "done");
    this.attestCount += 1;
    this.lastVaultKey = result.vaultKey;

    const credential = credentialFromVaultEntry(
      result.vaultKey,
      result.txHash,
      result.timestamp,
      result.metrics,
    );
    return { credential, stages, replayed: true };
  }

  async vault(): Promise<AttestedCredential[]> {
    const sidecar = this.requireSidecar();
    const state = await sidecar.state();
    return state.vault.map((entry) => {
      const key = entry.vaultKey ?? entry.key ?? "";
      const metrics = entry.metrics ?? (entry.metric ? [entry.metric] : []);
      return credentialFromVaultEntry(key, undefined, entry.timestamp, metrics);
    });
  }

  async listWagers(): Promise<WagerView[]> {
    const sidecar = this.requireSidecar();
    const list = await sidecar.wagers();
    return list.wagers.map((entry) => this.wagerViewFrom(entry));
  }

  async createWager(req: WagerCreateRequest): Promise<WagerView> {
    const sidecar = this.requireSidecar();
    const opponent = athleteLetter(req.opponent);
    const deadlineBlock = hexOf(
      BigInt(req.deadlineBlock) > 0n
        ? BigInt(req.deadlineBlock)
        : BigInt(Math.floor(Date.now() / 1000)) + 90n,
    );
    const created = await sidecar.createWager({
      athlete: "A",
      opponent,
      metricId: hexOf(req.metricId),
      stake: hexOf(BigInt(req.stake) * NIGHT_BASE),
      deadlineBlock,
    });
    return this.wagerViewFrom({
      id: created.wagerId,
      challenger: created.challenger,
      opponent: created.opponent,
      metricId: created.metricId,
      stake: created.stake,
      deadlineBlock: created.deadlineBlock,
      accepted: false,
      settled: false,
      challengerSubmitted: false,
      opponentSubmitted: false,
      winner: null,
    });
  }

  async acceptWager(id: number): Promise<WagerView> {
    const sidecar = this.requireSidecar();
    const wager = (await this.listWagers()).find((w) => w.id === id);
    if (!wager) throw new Error(`wager ${id} not found`);
    await sidecar.acceptWager({ athlete: athleteLetter(wager.opponent), id: String(id) });
    const updated = (await this.listWagers()).find((w) => w.id === id);
    if (!updated) throw new Error(`wager ${id} not found after accept`);
    return updated;
  }

  // Live mode: `credentialId` is the ACTING athlete's sidecar identity
  // ('A' or 'B') — the sidecar auto-derives the vaulted credential + value.
  async submitWorkout(id: number, credentialId: string): Promise<WagerView> {
    const sidecar = this.requireSidecar();
    const athlete = credentialId === "B" ? "B" : "A";
    await sidecar.submitWager({ athlete, id: String(id) });
    const updated = (await this.listWagers()).find((w) => w.id === id);
    if (!updated) throw new Error(`wager ${id} not found after submit`);
    return updated;
  }

  async settleWager(id: number): Promise<WagerSettleResult> {
    const sidecar = this.requireSidecar();
    const before = (await this.listWagers()).find((w) => w.id === id);
    if (!before) throw new Error(`wager ${id} not found`);
    const result = await sidecar.settleWager({ athlete: "A", id: String(id) });
    const settled = (await this.listWagers()).find((w) => w.id === id);
    if (!settled) throw new Error(`wager ${id} not found after settle`);

    const winner: Athlete | undefined =
      result.winner === "tie" || result.winner === null
        ? undefined
        : result.winner === "A"
          ? ATHLETE_A
          : ATHLETE_B;
    const challengerIsA = settled.challenger.handle === ATHLETE_A.handle;
    const challengerValue = toNumber(
      (challengerIsA ? result.disclosed.A : result.disclosed.B) ?? undefined,
      0,
    );
    const opponentValue = toNumber(
      (challengerIsA ? result.disclosed.B : result.disclosed.A) ?? undefined,
      0,
    );
    // One disclosed value null + a winner = forfeit; both null = refund.
    const forfeit =
      result.winner !== null &&
      result.winner !== "tie" &&
      (result.disclosed.A === null || result.disclosed.B === null);

    const summary =
      result.winner === null
        ? "Neither submitted — both stakes refunded"
        : result.winner === "tie"
          ? "Dead heat — stakes returned"
          : forfeit
            ? `${winner?.name} wins by forfeit — the pot moves under seal`
            : `${winner?.name} wins — sealed comparison revealed at settlement`;

    settled.result = {
      winner,
      tie: result.winner === "tie",
      forfeit,
      pot: nightToDisplay(toNumber(result.potNIGHT, 0)),
      currency: "NIGHT",
      disclosed: !forfeit && result.winner !== null && result.winner !== "tie",
      challengerValue,
      opponentValue,
      nft: result.nft,
      summary,
    };

    return {
      wager: settled,
      reveal: {
        sealedForRoom: true,
        comparison:
          !forfeit && (challengerValue > 0 || opponentValue > 0)
            ? { challengerValue, opponentValue }
            : undefined,
      },
    };
  }

  private wagerViewFrom(entry: SidecarWagerEntry): WagerView {
    const challenger = this.athleteOf(entry.challenger, "challenger");
    const opponent = this.athleteOf(entry.opponent, "opponent");
    const id = toNumber(entry.id, 0);
    const bothSubmitted = entry.challengerSubmitted && entry.opponentSubmitted;
    const status: WagerView["status"] = entry.settled
      ? "settled"
      : entry.accepted && bothSubmitted
        ? "submitted"
        : entry.accepted
          ? "accepted"
          : "open";
    const submissions: WagerSubmission[] = [
      ...(entry.challengerSubmitted
        ? [{ athlete: challenger, sealed: true, commitment: "sealed" }]
        : []),
      ...(entry.opponentSubmitted
        ? [{ athlete: opponent, sealed: true, commitment: "sealed" }]
        : []),
    ];
    const winner =
      entry.settled && (entry.winner === "A" || entry.winner === "B")
        ? entry.winner === "A"
          ? ATHLETE_A
          : ATHLETE_B
        : undefined;
    const result: WagerResult | undefined =
      entry.settled && winner
        ? {
            winner,
            tie: entry.winner === "tie",
            forfeit: false,
            pot: nightToDisplay(toNumber(entry.stake, 0) * 2),
            currency: "NIGHT",
            disclosed: true,
            summary: `${winner.name} wins — the losing number stays sealed`,
          }
        : undefined;
    return {
      id,
      title: `Live wager #${id} — ${challenger.name} vs ${opponent.name}`,
      metric: metricById(BigInt(toNumber(entry.metricId, 1))),
      stake: nightToDisplay(toNumber(entry.stake, 0)),
      deadlineBlock: BigInt(toNumber(entry.deadlineBlock, 0)),
      createdAt: Date.now() - id * 60_000,
      status,
      challenger,
      opponent,
      submissions,
      result,
    };
  }

  private athleteOf(letter: string, role: "challenger" | "opponent"): Athlete {
    if (letter === "A") return ATHLETE_A;
    if (letter === "B") return ATHLETE_B;
    return {
      name: `Identity ${letter.slice(0, 10)}`,
      handle: letter.slice(0, 16),
      role: role === "challenger" ? "opponent" : "other",
      holderBinding: letter,
    };
  }

  async streak(): Promise<StreakView> {
    const sidecar = this.requireSidecar();
    const state = await sidecar.state();
    return streakViewFrom(state.streaks, "sidecar:streak");
  }

  async advanceStreak(): Promise<StreakView> {
    const sidecar = this.requireSidecar();
    const vaultKey = await this.currentVaultKey(sidecar);
    const result = await sidecar.advanceStreak(vaultKey);
    return streakViewFrom(
      { streakCount: result.streakCount, lastDay: result.lastDay },
      "sidecar:streak",
    );
  }

  async badges(): Promise<BadgeView[]> {
    const sidecar = this.requireSidecar();
    const state = await sidecar.state();
    return badgeViewsFrom(state.badges);
  }

  async mintBadge(badgeId: number): Promise<BadgeView> {
    const sidecar = this.requireSidecar();
    const vaultKey = await this.currentVaultKey(sidecar);
    const result = await sidecar.mintBadge(vaultKey, badgeId);
    const badge = BADGES.find((b) => b.id === badgeId);
    if (!badge) throw new Error(`unknown badge ${badgeId}`);
    if (!result.minted) {
      throw new Error(`sidecar could not mint badge ${badgeId} — requirement unmet?`);
    }
    return { ...badge, minted: true, mintedAt: Date.now() };
  }

  async proveBadge(badgeId: number, verifier: string): Promise<BadgeProof> {
    const sidecar = this.requireSidecar();
    const result = await sidecar.proveBadge(badgeId);
    if (!result.verified) {
      throw new Error(`verification failed for badge ${badgeId} — not minted on-chain?`);
    }
    const badge = BADGES.find((b) => b.id === badgeId);
    return {
      badgeId,
      badgeLabel: badge?.label ?? `badge ${badgeId}`,
      verifier,
      proofId: result.verifierBinding || displayHash(`sidecar:proof:${badgeId}:${Date.now()}`),
      verifiedAt: Date.now(),
      statement: `Athlete holds badge "${badge?.label ?? badgeId}" — verified on-chain`,
      dataStillSealed: true,
    };
  }

  async notaryStatus(): Promise<NotaryInfo[]> {
    const healths = await Promise.all([0, 1, 2].map((i) => notaryHealth(i)));
    const { loadDeployInfo } = await import("./deploy-info");
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

  private requireSidecar(): SidecarHandle {
    if (!this.sidecar) {
      throw new Error(
        `demo service offline (${SIDECAR_URL}) — connect first, or check the sidecar`,
      );
    }
    return this.sidecar;
  }

  private async currentVaultKey(sidecar: SidecarHandle): Promise<string> {
    if (this.lastVaultKey) return this.lastVaultKey;
    const state = await sidecar.state();
    const first = state.vault[0];
    const key = first?.vaultKey ?? first?.key;
    if (!key) throw new Error("no vaulted credential — attest a workout first");
    this.lastVaultKey = key;
    return key;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const liveStages = (): AttestationStage[] => [
  {
    id: "tls",
    label: "Replaying attested TLS session",
    detail: "pre-recorded via attestor-core (identical crypto path)",
    state: "pending",
  },
  {
    id: "notarize",
    label: "Notarizing — sidecar collects 2-of-3",
    detail: "3 instances polled, signatures verified, assertion signed",
    state: "pending",
  },
  {
    id: "chain",
    label: "Submitting to the contract",
    detail: "verifyAttestation → credential vaulted on-chain",
    state: "pending",
  },
];

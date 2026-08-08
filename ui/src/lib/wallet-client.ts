import { logError } from "./logger";
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

import type { DemoMode } from "../config";
import { NETWORK_ID, NOTARY_URLS } from "../config";
import { ATHLETE_A, BADGES } from "../domain/story";
import type {
  Athlete,
  AttestationProgress,
  AttestationStage,
  AttestedCredential,
  AttestOutcome,
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
} from "../domain/types";
import { metricById } from "../domain/types";
import { attestStrava, proofToNotaryArtifacts } from "./attest/attest-browser";
import {
  type AthleteIdentity,
  athleteIdentityFromExchange,
} from "./attest/identity";
import {
  buildAuthUrl,
  emptyAccountGuard,
  exchangeCode,
  getValidAccessToken,
  localStorageTokenStore,
  parseAuthCallback,
} from "./attest/strava";
import { displayHash, hexShort } from "./format";
import { notaryHealth } from "./notary-api";
import {
  badgeViewsFrom,
  credentialFromVaultEntry,
  streakViewFrom,
  vaultEntriesOf,
} from "./state-mappers";
import {
  getWagerOpenings,
  hexOf as hexOfBigint,
  OPENING_RELAY_TIMEOUT,
  postWagerOpening,
  waitForBothOpenings,
} from "./wager-relay";
import {
  loadWalletBridge,
  type WalletAttestResult,
  type WalletMetric,
  type WalletStrideSession,
  type WalletWagerRouting,
  type WalletWagerView,
} from "./wallet-bridge";
import { connectWallet, type WalletConnection } from "./wallet-connector";
import type { WfClient } from "./wf-client";

// Typed flow error the UI can branch on (Strava panel states).
export class StravaFlowError extends Error {
  constructor(
    readonly code: "strava-auth-required" | "no-activities" | "strava-api",
    message: string,
  ) {
    super(message);
    this.name = "StravaFlowError";
  }
}

interface AttestationRecord {
  attestation: WalletAttestResult["attestation"];
  metrics: WalletMetric[];
  txHash?: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Deterministic per wallet address — the private-state store and backup key.
export const walletStoreName = (coinPublicKey: string): string =>
  `wf-wallet-${coinPublicKey.replace(/[^a-zA-Z0-9]/g, "").slice(-24)}`;

const bytesToHex = (bytes: Uint8Array): string =>
  "0x" +
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const hexToBytes = (hex: string): Uint8Array => {
  const bare = hex.replace(/^0x/, "");
  const out = new Uint8Array(bare.length / 2);
  for (let i = 0; i * 2 < bare.length; i += 1) {
    out[i] = Number.parseInt(bare.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

const parseHolderBinding = (input: string): bigint => {
  const hex = input.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "challenge ID must be the opponent\u2019s 64-hex holder binding (0x…, 32 bytes)",
    );
  }
  return BigInt("0x" + hex);
};

const syntheticAthlete = (
  holderBinding: string,
  role: Athlete["role"],
): Athlete => ({
  name: `Athlete ${hexShort(holderBinding, 8, 6)}`,
  handle: hexShort(holderBinding, 8, 6),
  role,
  holderBinding,
});

const bigintToHex = (value: bigint): string => "0x" + value.toString(16);

export class WalletClient implements WfClient {
  readonly mode: DemoMode = "wallet";

  // Test seam: inject a bridge (the stub) instead of loading the real api
  // module. Production code always uses loadWalletBridge().
  constructor(
    private readonly bridgeOverride?: import("./wallet-bridge").WalletBridge,
  ) {}

  private async bridge(): Promise<import("./wallet-bridge").WalletBridge> {
    return this.bridgeOverride ?? (await loadWalletBridge());
  }

  private connection: WalletConnection | null = null;
  private session: WalletStrideSession | null = null;
  private stravaIdentity: AthleteIdentity | null = null;

  // Per-credential notarized attestations (needed to re-stage at submit time
  // — the private state holds only the LATEST assertion).
  private attestations = new Map<string, AttestationRecord>();
  private shortIdIndex = new Map<string, string>();

  // My remembered (value, rand) opening per wager + the last settle's
  // openings (for the reveal). Session-only — NOT part of the backup.
  private openings = new Map<number, { value: bigint; rand: Uint8Array }>();
  private lastOpenings = new Map<
    number,
    {
      challenger: { value: bigint; rand: Uint8Array };
      opponent: { value: bigint; rand: Uint8Array };
    }
  >();

  private storeName(): string {
    if (!this.connection) throw new Error("wallet not connected");
    return walletStoreName(this.connection.coinPublicKey);
  }

  private requireConnection(): WalletConnection {
    if (!this.connection) throw new Error("wallet not connected");
    return this.connection;
  }

  private requireSession(): WalletStrideSession {
    if (!this.session) {
      throw new Error("wallet not connected — connect first");
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
        role: "local",
        holderBinding: binding,
      };
    }
    return {
      name: "Wallet athlete",
      handle: hexShort(this.connection?.coinPublicKey ?? "0x00", 6, 4),
      role: "local",
      holderBinding: binding,
    };
  }

  async connect(rdns?: string): Promise<ClientSession> {
    const connection = await connectWallet(undefined, rdns);
    this.connection = connection;
    const bridge = await this.bridge();
    const { loadDeployInfo } = await import("./deploy-info");
    const deploy = await loadDeployInfo();
    await bridge.initializeProviders(connection.api);
    this.session = await bridge.joinStrideFromBrowser(
      connection.api,
      deploy.contractAddress,
      this.storeName(),
    );
    this.stravaIdentity = this.readStravaIdentity();
    return {
      mode: "wallet",
      athlete: this.stravaAthlete(),
      walletConnected: true,
      walletLabel: `${connection.name} · ${hexShort(connection.shieldedAddress, 8, 6)}`,
      walletAddress: connection.shieldedAddress,
      networkId: connection.networkId,
    };
  }

  // ------------------------------------------------------------ Strava -----

  stravaStatus(): {
    connected: boolean;
    athleteName?: string;
    stravaId?: number;
  } {
    const identity = this.stravaIdentity ?? this.readStravaIdentity();
    if (!identity) return { connected: false };
    return {
      connected: true,
      athleteName: identity.name,
      stravaId: identity.stravaId,
    };
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
    window.history.replaceState({}, "", window.location.origin);
    return true;
  }

  // ----------------------------------------------------------- attest -----

  async attest(onProgress?: AttestationProgress): Promise<AttestOutcome> {
    const session = this.requireSession();
    const stages = walletStages();
    const publish = () => onProgress?.(stages.map((stage) => ({ ...stage })));
    const mark = (id: string, state: AttestationStage["state"]) => {
      for (const s of stages) if (s.id === id) s.state = state;
      publish();
    };

    publish();
    mark("guard", "active");
    let token: string;
    try {
      token = await getValidAccessToken();
    } catch (err) {
      mark("guard", "error");
      logError("wallet-client.getToken", err);
      throw new StravaFlowError(
        "strava-auth-required",
        "No Strava account connected — connect Strava first (the client secret never touches this browser)",
      );
    }

    const guard = await emptyAccountGuard(token).catch((err) => {
      mark("guard", "error");
      throw err;
    });
    if (!guard.canInteract) {
      mark("guard", "error");
      throw new StravaFlowError(
        "no-activities",
        "Strava account has no activities yet — upload a real workout on Strava, then retry",
      );
    }
    mark("guard", "done");

    mark("tls", "active");
    const result = await attestStrava(token).catch((err) => {
      mark("tls", "error");
      throw new StravaFlowError(
        "strava-api",
        `attestation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    const artifacts = proofToNotaryArtifacts(result);
    mark("tls", "done");

    mark("notarize", "active");
    const attested = await session
      .attest(artifacts, () => {
        mark("notarize", "done");
        mark("chain", "active");
      })
      .catch((err) => {
        const active = stages.find((stage) => stage.state === "active");
        if (active) mark(active.id, "error");
        throw err;
      });
    if (stages.find((stage) => stage.id === "notarize")?.state === "active") {
      mark("notarize", "done");
      mark("chain", "active");
    }
    mark("chain", "done");
    this.rememberAttestation(attested);

    return {
      credential: this.credentialFrom(attested),
      stages,
      replayed: false,
    };
  }

  private rememberAttestation(attested: WalletAttestResult): void {
    const key = bytesToHex(attested.vaultKey);
    const shortId = hexShort(key, 12, 8);
    this.attestations.set(key, {
      attestation: attested.attestation,
      metrics: attested.metrics,
      txHash: attested.txHash,
    });
    this.shortIdIndex.set(shortId, key);
  }

  private attestationFor(credentialId: string): AttestationRecord | undefined {
    const isFullKey = /^0x[0-9a-f]{64}$/.test(credentialId);
    const key = isFullKey ? credentialId : this.shortIdIndex.get(credentialId);
    if (!key) return undefined;
    return this.attestations.get(key);
  }

  private credentialFrom(attested: WalletAttestResult): AttestedCredential {
    const key = bytesToHex(attested.vaultKey);
    const base = credentialFromVaultEntry(
      key,
      attested.txHash,
      Date.now(),
      attested.metrics,
    );
    return {
      ...base,
      athlete: this.stravaAthlete(),
      source: "live-session",
      notarySignatures: 2,
    };
  }

  async vault(): Promise<AttestedCredential[]> {
    const session = this.requireSession();
    const state = await session.readState();
    const mine = this.stravaAthlete();
    const myBig = this.myBindingBig();
    const result: AttestedCredential[] = [];
    for (const entry of vaultEntriesOf(state.vault)) {
      if (
        myBig !== null &&
        entry.holderBinding !== null &&
        entry.holderBinding !== myBig
      ) {
        continue;
      }
      const record = this.attestations.get(entry.vaultKey);
      const metrics = record?.metrics ?? [];
      const credential = credentialFromVaultEntry(
        entry.vaultKey,
        record?.txHash,
        entry.timestamp,
        metrics,
      );
      result.push({ ...credential, athlete: mine, source: "live-session" });
    }
    // Newest first — the ledger Map's iteration order is NOT insertion order,
    // and screens rely on credentials[0] being the LATEST attested workout.
    result.sort((a, b) => b.timestamp - a.timestamp);
    return result;
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
    const myBinding = this.myBindingBig();
    const before = await session.listWagers();
    const maxBefore = before.reduce((m, w) => (w.id > m ? w.id : m), 0n);
    await session.createWager({
      opponentBinding,
      metricId: req.metricId,
      stake: BigInt(Math.round(req.stake * 1_000_000_000_000)),
      deadlineBlock: req.deadlineBlock,
      routing,
    });
    // Post-create read-back: poll until the NEW wager (id > any seen before,
    // challenger = me) is visible — indexer lag is real; the last-element
    // guess silently picked the wrong wager (audit P1-4).
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const all = await session.listWagers();
      const created = all.find(
        (w) =>
          w.id > maxBefore &&
          (myBinding === null || w.challenger === myBinding),
      );
      if (created) return this.wagerView(created);
      await delay(1_000);
    }
    throw new Error(
      "created on-chain but not yet indexed — refresh the Wagers tab",
    );
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
      throw new Error(
        "credential not found in this session — only workouts attested in this session can be sealed (re-attest the workout, then submit)",
      );
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
    const mySide =
      wager.challenger === BigInt(session.holderBinding) ? "A" : "B";
    await postWagerOpening(id, mySide, value, rand).catch((err) => {
      logError("wallet-client.relayOpening", err);
      throw new Error(
        `submission sealed on-chain but the opening relay failed: ${err instanceof Error ? err.message : String(err)} — retry settle later`,
      );
    });
    const view = (await this.listWagers()).find((w) => w.id === id);
    if (!view) throw new Error(`wager ${id} not found`);
    return view;
  }

  // Settle: when BOTH submissions exist, ensure MY opening is on the relay,
  // poll until both are present, stage [challenger, opponent] into
  // private-state wagerOpenings (order is contract law: challenger first),
  // then settleWager on-chain. When fewer than two submissions exist
  // (forfeit / both-gave-up), the contract ignores the openings — settle with
  // the defaults so the refund path is reachable from any browser.
  async settleWager(id: number): Promise<WagerSettleResult> {
    const session = this.requireSession();
    const wagers = await session.listWagers();
    const wager = wagers.find((w) => Number(w.id) === id);
    if (!wager) throw new Error(`unknown wager ${id}`);
    const bothSubmitted =
      wager.challengerSubmission.is_some && wager.opponentSubmission.is_some;

    let openings: {
      challenger: { value: bigint; rand: Uint8Array };
      opponent: { value: bigint; rand: Uint8Array };
    };
    if (bothSubmitted) {
      const mySide =
        wager.challenger === BigInt(session.holderBinding) ? "A" : "B";
      let myOpening: { value: bigint; rand: Uint8Array } | null =
        this.openings.get(id) ?? null;
      if (!myOpening) {
        // The (value, rand) pair is session-only — after a page reload the
        // relay is the source of truth: BOTH sides posted at submit time
        // (TTL 30 min), so my opening is recoverable from it.
        myOpening = await this.relayOpeningFor(id, mySide);
        if (!myOpening) {
          throw new Error(
            "no recorded opening for this wager and none on the relay for your side — your submission likely predates the relay fix or is older than the relay TTL (30 min). Attest a fresh workout, submit it to this wager, then settle.",
          );
        }
      }
      await postWagerOpening(id, mySide, myOpening.value, myOpening.rand);

      const relayed = await waitForBothOpenings(id, {
        timeoutMs: OPENING_RELAY_TIMEOUT.ms,
      });
      openings = {
        challenger: {
          value: BigInt(relayed.challenger.value),
          rand: hexToBytes(relayed.challenger.rand),
        },
        opponent: {
          value: BigInt(relayed.opponent.value),
          rand: hexToBytes(relayed.opponent.rand),
        },
      };
      const mineRelayed =
        (relayed.challenger.rand === bytesToHex(myOpening.rand) &&
          relayed.challenger.value === hexOfBigint(myOpening.value)) ||
        (relayed.opponent.rand === bytesToHex(myOpening.rand) &&
          relayed.opponent.value === hexOfBigint(myOpening.value));
      if (!mineRelayed) {
        throw new Error(
          "the relayed openings do not include your submission — retry settle",
        );
      }
    } else {
      openings = {
        challenger: { value: 0n, rand: new Uint8Array(32) },
        opponent: { value: 0n, rand: new Uint8Array(32) },
      };
    }

    await session.settleWager(BigInt(id), openings);
    if (bothSubmitted) {
      this.lastOpenings.set(id, openings);
    }
    const view = (await this.listWagers()).find((w) => w.id === id);
    if (!view) throw new Error(`wager ${id} not found`);
    return {
      wager: view,
      reveal: {
        sealedForRoom: true,
        ...(bothSubmitted
          ? {
              comparison: {
                challengerValue: Number(openings.challenger.value),
                opponentValue: Number(openings.opponent.value),
              },
            }
          : {}),
      },
    };
  }

  // Recover MY opening from the relay after a page reload (both sides post
  // at submit time; TTL 30 min). Returns null when my side never relayed —
  // the caller errors loudly then.
  private async relayOpeningFor(
    id: number,
    mySide: "A" | "B",
  ): Promise<{ value: bigint; rand: Uint8Array } | null> {
    const openings = await getWagerOpenings(id);
    const mine = openings.find((o) => o.who === mySide);
    return mine
      ? { value: BigInt(mine.value), rand: hexToBytes(mine.rand) }
      : null;
  }

  private claimValueFor(record: AttestationRecord, metricId: bigint): bigint {
    const claims = (
      record.attestation.assertion as {
        claims?: { metricId: bigint; value: bigint }[];
      }
    ).claims;
    const claim = (claims ?? []).find((c) => c.metricId === metricId);
    if (!claim) {
      throw new Error(
        `attestation has no claim for metric ${metricId} — attest a workout that includes it`,
      );
    }
    return claim.value;
  }

  // 32 random bytes — the persistentCommit rand (audit L1). No field mask.
  private freshSubmissionRand(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  private async myRouting(): Promise<WalletWagerRouting> {
    const connection = this.requireConnection();
    const { unshieldedAddress } = await connection.api.getUnshieldedAddress();
    const { MidnightBech32m, UnshieldedAddress } =
      await import("@midnight-ntwrk/wallet-sdk-address-format");
    // The wallet hands us a bech32m STRING; the codec decodes parsed instances.
    const decoded = UnshieldedAddress.codec.decode(
      NETWORK_ID,
      MidnightBech32m.parse(unshieldedAddress),
    );
    // hexString relies on Buffer#toString('hex') (Node-only — the browser's
    // Uint8Array would render comma-joined). Convert the raw bytes ourselves.
    const bytes = decoded.data as Uint8Array;
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { encodeUserAddress } = await import("@midnight-ntwrk/ledger-v8");
    const payout = encodeUserAddress(hex);
    const coinKey = { bytes: await this.coinKeyBytes() };
    return { payout, coinKey };
  }

  // The DApp Connector's shieldedCoinPublicKey is bech32m per the API doc
  // (the wallet SDK's CoinPublicKey is hex — Lace has shipped both over time);
  // accept either form defensively.
  private async coinKeyBytes(): Promise<Uint8Array> {
    const cpk = this.requireConnection().coinPublicKey;
    const bare = cpk.replace(/^0x/, "");
    if (/^[0-9a-fA-F]{64}$/.test(bare)) {
      const out = new Uint8Array(32);
      for (let i = 0; i < 32; i += 1) {
        out[i] = Number.parseInt(bare.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    const { MidnightBech32m, ShieldedCoinPublicKey } =
      await import("@midnight-ntwrk/wallet-sdk-address-format");
    return (
      ShieldedCoinPublicKey.codec.decode(NETWORK_ID, MidnightBech32m.parse(cpk))
        .data as Uint8Array
    ).slice();
  }

  private wagerView(w: WalletWagerView): WagerView {
    const myBinding = this.session?.holderBinding ?? "";
    const myBig = myBinding ? BigInt(myBinding) : null;
    const amChallenger = myBig !== null && w.challenger === myBig;
    const mine = this.stravaAthlete();
    const challengerHex = bigintToHex(w.challenger);
    const opponentHex = bigintToHex(w.opponent);
    const challenger: Athlete = amChallenger
      ? mine
      : syntheticAthlete(challengerHex, "opponent");
    const opponent: Athlete = !amChallenger
      ? mine
      : syntheticAthlete(opponentHex, "opponent");

    const status: WagerStatus = w.settled
      ? "settled"
      : !w.accepted
        ? "open"
        : w.challengerSubmission.is_some && w.opponentSubmission.is_some
          ? "submitted"
          : "accepted";

    const submissions: WagerSubmission[] = [];
    if (w.challengerSubmission.is_some) {
      submissions.push({
        athlete: challenger,
        sealed: true,
        commitment: hexShort(bytesToHex(w.challengerSubmission.value), 10, 8),
      });
    }
    if (w.opponentSubmission.is_some) {
      submissions.push({
        athlete: opponent,
        sealed: true,
        commitment: hexShort(bytesToHex(w.opponentSubmission.value), 10, 8),
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
    stakeNIGHT: number,
  ): WagerResult {
    const openings = this.lastOpenings.get(Number(w.id));
    const pot = stakeNIGHT * 2;
    const challengerSubmitted = w.challengerSubmission.is_some;
    const opponentSubmitted = w.opponentSubmission.is_some;
    const forfeit = challengerSubmitted !== opponentSubmitted;

    // Full disclosure only when THIS browser settled (it staged both
    // openings). The ledger stores SEALED commitments — never present them
    // as values (audit P1-F).
    if (openings) {
      const challengerValue = Number(openings.challenger.value);
      const opponentValue = Number(openings.opponent.value);
      const tie = !forfeit && challengerValue === opponentValue;
      let winner: Athlete | undefined;
      if (forfeit) {
        winner = challengerSubmitted ? challenger : opponent;
      } else if (!tie) {
        winner = challengerValue > opponentValue ? challenger : opponent;
      }
      return {
        winner,
        tie,
        forfeit,
        pot,
        currency: "NIGHT",
        disclosed: true,
        challengerValue,
        opponentValue,
        nft: undefined, // the winner NFT mints to the winner's coin key — not observable from the wallet's contract view
        summary: forfeit
          ? `${winner?.name ?? "The submitter"} wins ${pot} NIGHT by forfeit`
          : tie
            ? `Tie — both stakes refunded (${pot} NIGHT pot)`
            : `${winner?.name} wins ${pot} NIGHT — sealed comparison revealed at settlement`,
      };
    }

    // No local openings (opponent's browser, or after a reload): the winner
    // is not recorded on-chain, so no values and no winner name are shown.
    if (challengerSubmitted && opponentSubmitted) {
      return {
        winner: undefined,
        tie: false,
        forfeit: false,
        pot,
        currency: "NIGHT",
        disclosed: false,
        challengerValue: undefined,
        opponentValue: undefined,
        nft: undefined,
        summary: `Settled — both sealed submissions counted (${pot} NIGHT pot). The comparison was disclosed at settlement in the settling browser.`,
      };
    }
    if (forfeit) {
      const winner = challengerSubmitted ? challenger : opponent;
      return {
        winner,
        tie: false,
        forfeit: true,
        pot,
        currency: "NIGHT",
        disclosed: false,
        challengerValue: undefined,
        opponentValue: undefined,
        nft: undefined,
        summary: `${winner.name} wins ${pot} NIGHT by forfeit`,
      };
    }
    return {
      winner: undefined,
      tie: false,
      forfeit: false,
      pot,
      currency: "NIGHT",
      disclosed: false,
      challengerValue: undefined,
      opponentValue: undefined,
      nft: undefined,
      summary: `Neither submitted — both stakes refunded (${pot} NIGHT pot)`,
    };
  }

  // ------------------------------------------------- streak / badge --------

  async streak(): Promise<StreakView> {
    const session = this.requireSession();
    const state = await session.readState();
    return streakViewFrom(
      state.streaks,
      "wallet:streak",
      this.myBindingBig() ?? undefined,
    );
  }

  async advanceStreak(): Promise<StreakView> {
    const session = this.requireSession();
    const vaultKey = await this.stagedVaultKey(session);
    const result = await session.advanceStreak(vaultKey);
    return streakViewFrom(
      { streakCount: result.streakCount, lastDay: result.lastDay },
      "wallet:streak",
    );
  }

  async badges(): Promise<BadgeView[]> {
    const session = this.requireSession();
    const state = await session.readState();
    return badgeViewsFrom(state.badges, this.myBindingBig() ?? undefined);
  }

  async mintBadge(badgeId: number): Promise<BadgeView> {
    const session = this.requireSession();
    const vaultKey = await this.stagedVaultKey(session);
    const result = await session.mintBadge(badgeId, vaultKey);
    const badge = BADGES.find((b) => b.id === badgeId);
    if (!badge) throw new Error(`unknown badge ${badgeId}`);
    if (!result.minted)
      throw new Error(`badge ${badgeId} not minted — requirement unmet?`);
    return { ...badge, minted: true, mintedAt: Date.now() };
  }

  async proveBadge(badgeId: number, verifier: string): Promise<BadgeProof> {
    const session = this.requireSession();
    // The verifier must be a real holder binding (0x + 64 hex) — the circuit
    // discloses it as the third party's identity. Handles/junk strings are
    // rejected loudly instead of being hashed into a 32-bit guess (audit P2-H).
    const verifierBinding = parseHolderBinding(verifier);
    const result = await session.proveBadge(badgeId, verifierBinding);
    if (!result.verified)
      throw new Error(`verification failed for badge ${badgeId}`);
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

  // The vault key the streak/badge circuits can actually open: the CURRENTLY
  // STAGED attestation (the only one the private state holds). No
  // vault-iteration guesses — those can pick a credential whose assertion is
  // not staged and fail with "Credential does not open to this assertion".
  private async stagedVaultKey(
    session: WalletStrideSession,
  ): Promise<Uint8Array> {
    const key = await session.stagedVaultKey();
    if (!key) throw new Error("no attestation staged — attest a workout first");
    return key;
  }

  private myBindingBig(): bigint | null {
    const binding = this.session?.holderBinding ?? "";
    return binding ? BigInt(binding) : null;
  }
}

const walletStages = (): AttestationStage[] => [
  {
    id: "guard",
    label: "Strava account check",
    detail: "real API check — no fabricated data",
    state: "pending",
  },
  {
    id: "tls",
    label: "Witnessing TLS session",
    detail: "attestor-core tunnels to www.strava.com; stwo ZK proof generated",
    state: "pending",
  },
  {
    id: "notarize",
    label: "Notarizing — 2-of-3 collected",
    detail: "notaries verify + sign; wallet signs the contract tx",
    state: "pending",
  },
  {
    id: "chain",
    label: "Submitting via your wallet",
    detail: "verifyAttestation → credential vaulted on-chain",
    state: "pending",
  },
];

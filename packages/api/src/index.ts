// Stride contract wrapper (mirrors midnight-reference-app's SentinelContract)
// + notary client glue (NOTARY.md §5): collect ≥2 notary signatures over a
// proof artifact and package the verifyAttestation transaction. Demo flows
// (attest → deposit → wager → settle → withdraw; streak → badge → proveBadge)
// are exposed as callable functions for the UI agent.

import {
  type ContractProviders,
  deployContract,
  type FoundContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import {
  type A_Assertion,
  CompactCompiledContract,
  createPrivateState,
  type Ledger,
  ledger,
  type PrivateState,
  pureCircuits,
  type SchnorrSignature,
  type StrideContractType,
} from "@witnessfitness/contract";
import { map, type Observable } from "rxjs";

export type StrideProviders = ContractProviders<StrideContractType>;

export const toHex = (bytes: Uint8Array): string => "0x" + Buffer.from(bytes).toString("hex");

export const fromHex = (hex: string): Uint8Array =>
  new Uint8Array(Buffer.from(hex.replace(/^0x/, ""), "hex"));

export type StrideDerivedState = Ledger;

const deriveState = (data: Parameters<typeof ledger>[0]): StrideDerivedState => ledger(data);

export interface NotarizedAttestation {
  assertion: A_Assertion;
  signatures: SchnorrSignature[];
  notaryIds: string[];
  metricSource: string;
  identifier: string;
}

const DUMMY_SIG: SchnorrSignature = { announcement: { x: 0n, y: 1n }, response: 0n };

const decodeBigint = (value: unknown): bigint =>
  typeof value === "bigint" ? value : BigInt(value as string);

const decodeClaim = (raw: {
  metricId: unknown;
  value: unknown;
}): A_Assertion["claims"][number] => ({
  metricId: decodeBigint(raw.metricId),
  value: decodeBigint(raw.value),
});

const decodeAssertion = (raw: Record<string, unknown>): A_Assertion => ({
  version: decodeBigint(raw.version),
  provider: decodeBigint(raw.provider),
  claims: (raw.claims as { metricId: unknown; value: unknown }[]).map(decodeClaim),
  claimCount: decodeBigint(raw.claimCount),
  timestamp: decodeBigint(raw.timestamp),
  nonce: fromHex(raw.nonce as string),
  reclaimProofHash: fromHex(raw.reclaimProofHash as string),
});

const decodeSignature = (raw: {
  announcement: { x: unknown; y: unknown };
  response: unknown;
}): SchnorrSignature => ({
  announcement: { x: decodeBigint(raw.announcement.x), y: decodeBigint(raw.announcement.y) },
  response: decodeBigint(raw.response),
});

const assertionsEqual = (a: A_Assertion, b: A_Assertion): boolean =>
  a.version === b.version &&
  a.provider === b.provider &&
  a.claimCount === b.claimCount &&
  a.timestamp === b.timestamp &&
  Buffer.from(a.nonce).equals(Buffer.from(b.nonce)) &&
  Buffer.from(a.reclaimProofHash).equals(Buffer.from(b.reclaimProofHash)) &&
  a.claims.every((c, i) => c.metricId === b.claims[i].metricId && c.value === b.claims[i].value);

export class NotaryClient {
  constructor(readonly urls: string[]) {}

  // POST the proof artifacts to every notary instance; require ≥2 valid
  // responses over the IDENTICAL assertion; keep the 3 signature slots.
  async attestate(proofArtifacts: unknown): Promise<NotarizedAttestation> {
    const results: {
      assertion: A_Assertion;
      signature: SchnorrSignature;
      notaryId: string;
      metricSource?: string;
      identifier?: string;
      url: string;
    }[] = [];
    const errors: string[] = [];
    await Promise.all(
      this.urls.map(async (url) => {
        try {
          const res = await fetch(`${url}/attestate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ proofArtifacts }),
          });
          const body = (await res.json()) as Record<string, unknown>;
          if (!res.ok || body.error) {
            throw new Error((body.error as string) ?? `HTTP ${res.status}`);
          }
          results.push({
            assertion: decodeAssertion(body.assertion as Record<string, unknown>),
            signature: decodeSignature(body.signature as Parameters<typeof decodeSignature>[0]),
            notaryId: body.notaryId as string,
            metricSource: body.metricSource as string | undefined,
            identifier: body.identifier as string | undefined,
            url,
          });
        } catch (error) {
          errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
    if (results.length < 2) {
      throw new Error(`fewer than 2 notaries signed: ${errors.join("; ")}`);
    }
    const first = results[0].assertion;
    for (const result of results.slice(1)) {
      if (!assertionsEqual(first, result.assertion)) {
        throw new Error(
          `notaries signed different assertions (${results[0].notaryId} vs ${result.notaryId})`,
        );
      }
    }
    // Slot mapping is by URL order (the registry was rotated in URL order:
    // slot i == urls[i]). Promise.all completion order is a RACE — assigning
    // by completion order mismatches the registry and every signature fails
    // in-circuit ("Insufficient valid signatures").
    const signatures: SchnorrSignature[] = [DUMMY_SIG, DUMMY_SIG, DUMMY_SIG];
    const notaryIds: string[] = ["", "", ""];
    for (const result of results) {
      const slot = this.urls.indexOf(result.url);
      if (slot >= 0 && slot < 3) {
        signatures[slot] = result.signature;
        notaryIds[slot] = result.notaryId;
      }
    }
    return {
      assertion: first,
      signatures,
      notaryIds,
      metricSource: results[0].metricSource ?? "unknown",
      identifier: results[0].identifier ?? "",
    };
  }
}

export class StrideContract {
  readonly providers: StrideProviders;
  readonly deployedContract: FoundContract<StrideContractType> | null;
  readonly contractAddress: string;
  readonly privateStateId: string;
  readonly state$: Observable<StrideDerivedState>;

  private constructor(
    providers: StrideProviders,
    deployedContract: FoundContract<StrideContractType> | null,
    contractAddress: string,
    privateStateId: string,
    state$: Observable<StrideDerivedState>,
  ) {
    this.providers = providers;
    this.deployedContract = deployedContract;
    this.contractAddress = contractAddress;
    this.privateStateId = privateStateId;
    this.state$ = state$;
  }

  static async deploy(
    providers: StrideProviders,
    privateStateId: string,
    initialPrivateState: PrivateState,
  ): Promise<StrideContract> {
    const deployedContract = await deployContract<StrideContractType>(providers, {
      compiledContract: CompactCompiledContract,
      privateStateId,
      initialPrivateState,
    });
    const contractAddress = deployedContract.deployTxData.public.contractAddress;
    return new StrideContract(
      providers,
      deployedContract,
      contractAddress,
      privateStateId,
      providers.publicDataProvider
        .contractStateObservable(contractAddress, { type: "latest" })
        .pipe(map((state) => deriveState(state.data))),
    );
  }

  static async join(
    providers: StrideProviders,
    contractAddress: string,
    privateStateId: string,
    initialPrivateState: PrivateState,
  ): Promise<StrideContract> {
    const deployedContract = await findDeployedContract<StrideContractType>(providers, {
      contractAddress,
      compiledContract: CompactCompiledContract,
      privateStateId,
      initialPrivateState,
    });
    return new StrideContract(
      providers,
      deployedContract,
      contractAddress,
      privateStateId,
      providers.publicDataProvider
        .contractStateObservable(contractAddress, { type: "latest" })
        .pipe(map((state) => deriveState(state.data))),
    );
  }

  // prepareAttestation + verifyAttestation in one call (the demo flow used
  // by the UI and the E2E script).
  async verifyAttestationWith(
    attestation: NotarizedAttestation,
    holderSecret: Uint8Array,
    commitRand: Uint8Array,
  ): Promise<ReturnType<StrideContract["verifyAttestation"]>> {
    await StrideContract.prepareAttestation(
      this.providers,
      this.privateStateId,
      this.contractAddress,
      attestation,
      holderSecret,
      commitRand,
    );
    return this.verifyAttestation();
  }

  async readState(): Promise<StrideDerivedState> {
    const state = await this.providers.publicDataProvider.queryContractState(this.contractAddress);
    if (!state) {
      throw new Error(`no contract state at ${this.contractAddress}`);
    }
    return deriveState(state.data);
  }

  private requireDeployed(): FoundContract<StrideContractType> {
    if (!this.deployedContract) {
      throw new Error("stride contract is not joined");
    }
    return this.deployedContract;
  }

  registerAdmin(): ReturnType<FoundContract<StrideContractType>["callTx"]["registerAdmin"]> {
    return this.requireDeployed().callTx.registerAdmin();
  }

  registerNotary(
    pk: { x: bigint; y: bigint },
    index: bigint,
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["registerNotary"]> {
    return this.requireDeployed().callTx.registerNotary(pk, index);
  }

  rotateNotary(
    index: bigint,
    newPk: { x: bigint; y: bigint },
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["rotateNotary"]> {
    return this.requireDeployed().callTx.rotateNotary(index, newPk);
  }

  blacklistNotary(
    index: bigint,
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["blacklistNotary"]> {
    return this.requireDeployed().callTx.blacklistNotary(index);
  }

  createWager(
    opponentBinding: bigint,
    metricId: bigint,
    stake: bigint,
    deadlineBlock: bigint,
    coinKey: { bytes: Uint8Array },
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["createWager"]> {
    return this.requireDeployed().callTx.createWager(
      opponentBinding,
      metricId,
      stake,
      deadlineBlock,
      coinKey,
    );
  }

  verifyAttestation(): ReturnType<
    FoundContract<StrideContractType>["callTx"]["verifyAttestation"]
  > {
    return this.requireDeployed().callTx.verifyAttestation();
  }

  acceptWager(
    id: bigint,
    coinKey: { bytes: Uint8Array },
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["acceptWager"]> {
    return this.requireDeployed().callTx.acceptWager(id, coinKey);
  }

  setTreasuryKey(
    key: { bytes: Uint8Array },
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["setTreasuryKey"]> {
    return this.requireDeployed().callTx.setTreasuryKey(key);
  }

  depositPoints(
    amount: bigint,
    coin: ShieldedCoin,
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["depositPoints"]> {
    return this.requireDeployed().callTx.depositPoints(amount, coin);
  }

  withdrawPoints(
    binding: bigint,
    amount: bigint,
    coin: ShieldedCoin,
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["withdrawPoints"]> {
    return this.requireDeployed().callTx.withdrawPoints(binding, amount, coin);
  }

  cancelWager(id: bigint): ReturnType<FoundContract<StrideContractType>["callTx"]["cancelWager"]> {
    return this.requireDeployed().callTx.cancelWager(id);
  }

  submitWorkout(
    wagerId: bigint,
    vaultKey: Uint8Array,
    value: bigint,
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["submitWorkout"]> {
    return this.requireDeployed().callTx.submitWorkout(wagerId, vaultKey, value);
  }

  settleWager(id: bigint): ReturnType<FoundContract<StrideContractType>["callTx"]["settleWager"]> {
    return this.requireDeployed().callTx.settleWager(id);
  }

  advanceStreak(
    vaultKey: Uint8Array,
    day: bigint,
    commitRand: Uint8Array,
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["advanceStreak"]> {
    return this.requireDeployed().callTx.advanceStreak(vaultKey, day, commitRand);
  }

  mintBadge(
    badgeId: bigint,
    vaultKey: Uint8Array,
    commitRand: Uint8Array,
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["mintBadge"]> {
    return this.requireDeployed().callTx.mintBadge(badgeId, vaultKey, commitRand);
  }

  proveBadge(
    badgeId: bigint,
    verifierBinding: bigint,
  ): ReturnType<FoundContract<StrideContractType>["callTx"]["proveBadge"]> {
    return this.requireDeployed().callTx.proveBadge(badgeId, verifierBinding);
  }

  static freshPrivateState(adminSecretKey: Uint8Array, holderSecret: Uint8Array): PrivateState {
    return createPrivateState(adminSecretKey, holderSecret);
  }

  // Load the stored private state (or seed it), merge the notarized
  // attestation, and persist — the verifyAttestation witness reads these
  // exact fields (packages/contract/src/witnesses.ts).
  static async prepareAttestation(
    providers: StrideProviders,
    privateStateId: string,
    contractAddress: string,
    attestation: NotarizedAttestation,
    holderSecret: Uint8Array,
    commitRand: Uint8Array,
  ): Promise<PrivateState> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = await providers.privateStateProvider.get(privateStateId);
    const base: PrivateState =
      existing ?? createPrivateState(new Uint8Array(32).fill(0xa1), holderSecret);
    const updated: PrivateState = {
      ...base,
      holderSecret,
      assertion: attestation.assertion,
      signatures: attestation.signatures,
      commitRand,
    };
    await providers.privateStateProvider.set(privateStateId, updated);
    return updated;
  }
}

// ---------------------------------------------------------------------------
// Demo flows (UI-facing callables, NOTARY.md §5). Holder secrets come from
// the UI/wallet layer; each flow returns the on-chain tx result.
// ---------------------------------------------------------------------------

export interface WorkoutContext {
  contract: StrideContract;
  privateStateId: string;
  holderSecret: Uint8Array;
}

// A shielded coin as the contract circuits see it (nonce/color/value — the
// wallet SDK supplies the mt_index when offering the spend). Native NIGHT
// coins have the zero color.
export interface ShieldedCoin {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
}

// Wager coin routing (Phase A v3 — points era): only the winner-NFT
// recipient's shielded coin key, pinned at create/accept. Real-money payout
// addresses no longer exist — wagers settle in points.
export interface WagerCoinRouting {
  coinKey: { bytes: Uint8Array };
}

// Pick the smallest native NIGHT coin with value >= minValue from a wallet
// state's shielded coin set (the reference app's exact-value selection,
// relaxed to "any coin big enough" — the contract returns change to the
// caller, so exact matches are unnecessary). null when the wallet lacks a
// usable coin.
export const selectNightCoin = (state: unknown, minValue: bigint): ShieldedCoin | null => {
  const coins =
    (
      state as {
        shielded?: { state?: { state?: { coins?: { nonce?: Uint8Array; color?: Uint8Array; value?: bigint }[] } } };
      }
    )?.shielded?.state?.state?.coins ?? [];
  const candidates = coins
    .filter(
      (coin): coin is ShieldedCoin =>
        coin.nonce !== undefined &&
        coin.color !== undefined &&
        coin.value !== undefined &&
        coin.value >= minValue &&
        coin.color.every((byte) => byte === 0),
    )
    .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  return candidates.length > 0 ? candidates[0] : null;
};

export const attestWorkout = async (
  ctx: WorkoutContext,
  attestation: NotarizedAttestation,
  commitRand: Uint8Array,
): Promise<{ vaultKey: Uint8Array; tx: unknown }> => {
  await StrideContract.prepareAttestation(
    ctx.contract.providers,
    ctx.privateStateId,
    ctx.contract.contractAddress,
    attestation,
    ctx.holderSecret,
    commitRand,
  );
  const tx = await ctx.contract.verifyAttestation();
  const vaultKey = pureCircuits.computeVaultKey(attestation.assertion, commitRand);
  // The indexer lags finalization — a single readState right after submit is
  // racy and rejected VALID attestations ("credential not found in vault").
  // Poll like the UI's post-create read-back (10 × 1s).
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const state = await ctx.contract.readState();
    if (state.vault.member(vaultKey)) {
      return { vaultKey, tx };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    "credential vaulted on-chain but not yet indexed — refresh the Vault tab shortly",
  );
};

export const createWagerFlow = (
  ctx: WorkoutContext,
  input: {
    opponentBinding: bigint;
    metricId: bigint;
    stake: bigint;
    deadlineBlock: bigint;
    coinKey: { bytes: Uint8Array };
  },
): ReturnType<StrideContract["createWager"]> =>
  ctx.contract.createWager(
    input.opponentBinding,
    input.metricId,
    input.stake,
    input.deadlineBlock,
    input.coinKey,
  );

export const acceptWagerFlow = (
  ctx: WorkoutContext,
  id: bigint,
  coinKey: { bytes: Uint8Array },
): ReturnType<StrideContract["acceptWager"]> => ctx.contract.acceptWager(id, coinKey);

export const depositPointsFlow = (
  ctx: WorkoutContext,
  amount: bigint,
  coin: ShieldedCoin,
): ReturnType<StrideContract["depositPoints"]> => ctx.contract.depositPoints(amount, coin);

export const withdrawPointsFlow = (
  ctx: WorkoutContext,
  binding: bigint,
  amount: bigint,
  coin: ShieldedCoin,
): ReturnType<StrideContract["withdrawPoints"]> =>
  ctx.contract.withdrawPoints(binding, amount, coin);

export const cancelWagerFlow = (
  ctx: WorkoutContext,
  id: bigint,
): ReturnType<StrideContract["cancelWager"]> => ctx.contract.cancelWager(id);

export const submitWorkoutFlow = (
  ctx: WorkoutContext,
  attestation: NotarizedAttestation,
  commitRand: Uint8Array,
  wagerId: bigint,
  vaultKey: Uint8Array,
  value: bigint,
): ReturnType<StrideContract["submitWorkout"]> =>
  StrideContract.prepareAttestation(
    ctx.contract.providers,
    ctx.privateStateId,
    ctx.contract.contractAddress,
    attestation,
    ctx.holderSecret,
    commitRand,
  ).then(() => ctx.contract.submitWorkout(wagerId, vaultKey, value));

export const settleWagerFlow = (
  ctx: WorkoutContext,
  id: bigint,
): ReturnType<StrideContract["settleWager"]> => ctx.contract.settleWager(id);

export const advanceStreakFlow = (
  ctx: WorkoutContext,
  attestation: NotarizedAttestation,
  commitRand: Uint8Array,
  vaultKey: Uint8Array,
  day: bigint,
): ReturnType<StrideContract["advanceStreak"]> =>
  StrideContract.prepareAttestation(
    ctx.contract.providers,
    ctx.privateStateId,
    ctx.contract.contractAddress,
    attestation,
    ctx.holderSecret,
    commitRand,
  ).then(() => ctx.contract.advanceStreak(vaultKey, day, commitRand));

export const mintBadgeFlow = (
  ctx: WorkoutContext,
  attestation: NotarizedAttestation,
  commitRand: Uint8Array,
  badgeId: bigint,
  vaultKey: Uint8Array,
): ReturnType<StrideContract["mintBadge"]> =>
  StrideContract.prepareAttestation(
    ctx.contract.providers,
    ctx.privateStateId,
    ctx.contract.contractAddress,
    attestation,
    ctx.holderSecret,
    commitRand,
  ).then(() => ctx.contract.mintBadge(badgeId, vaultKey, commitRand));

export const proveBadgeFlow = (
  ctx: WorkoutContext,
  badgeId: bigint,
  verifierBinding: bigint,
): ReturnType<StrideContract["proveBadge"]> => ctx.contract.proveBadge(badgeId, verifierBinding);

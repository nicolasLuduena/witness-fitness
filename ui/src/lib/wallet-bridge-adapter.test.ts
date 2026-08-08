// Regression net for the REAL wallet bridge adapter (audit P0-A/P0-B, P1):
// the stub bridge voids `routing` and `attestation` — the exact arguments
// that, when wired wrongly, break the live browser path (createWager with
// undefined payout/coinKey; submitWorkout staging assertion: undefined).
// This test drives adaptStrideSession against MOCKED api/browser+api+contract
// modules and asserts the shapes the real flow functions receive.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { adaptStrideSession, type WalletStrideSession } from './wallet-bridge';

const mocks = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const privateStateProvider = {
    setContractAddress: vi.fn(),
    get: vi.fn(async (id: string) => (store.has(id) ? store.get(id) : null)),
    set: vi.fn(async (id: string, state: unknown) => void store.set(id, state)),
  };
  const flows = {
    attestWorkout: vi.fn(),
    createWagerFlow: vi.fn(),
    acceptWagerFlow: vi.fn(),
    submitWorkoutFlow: vi.fn(),
    settleWagerFlow: vi.fn(),
    advanceStreakFlow: vi.fn(),
    mintBadgeFlow: vi.fn(),
    proveBadgeFlow: vi.fn(),
  };
  const contract = {
    contractAddress: '0xdeadbeef',
    providers: { privateStateProvider },
    readState: vi.fn(async () => ({
      vault: new Map(),
      streaks: { member: () => false, lookup: () => ({ count: 0n, lastDay: 0n }) },
      badges: new Map(),
      wagers: new Map(),
    })),
  };
  const pureCircuits = {
    holderBinding: vi.fn(() => 0x1234n),
    computeVaultKey: vi.fn((_assertion: unknown, commitRand: Uint8Array) => commitRand.slice()),
  };
  const attestate = vi.fn();
  const notarized = () => ({
    assertion: {
      version: 1n,
      provider: 1n,
      claims: [{ metricId: 1n, value: 3900n }],
      claimCount: 1n,
      timestamp: 1754640000n,
      nonce: new Uint8Array(32).fill(9),
      reclaimProofHash: new Uint8Array(32).fill(8),
    },
    signatures: [
      { announcement: { x: 1n, y: 2n }, response: 3n },
      { announcement: { x: 4n, y: 5n }, response: 6n },
    ],
  });
  const notarizedValue = notarized();
  const tx = (txHash: string) => ({ public: { txHash } });
  return { store, privateStateProvider, flows, contract, pureCircuits, attestate, notarized, notarizedValue, tx };
});

vi.mock('@witnessfitness/api/browser', () => ({
  joinStrideFromBrowser: vi.fn(async () => mocks.contract),
}));

vi.mock('@witnessfitness/api', () => ({
  NotaryClient: class {
    constructor(public readonly urls: string[]) {}
    attestate = mocks.attestate;
  },
  ...mocks.flows,
}));

vi.mock('@witnessfitness/contract', () => ({
  pureCircuits: mocks.pureCircuits,
}));

const api = {} as ConnectedAPI;

const sessionOf = (): Promise<WalletStrideSession> =>
  adaptStrideSession(api, '0xdeadbeef', 'wf-test-store');

const bytes = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

beforeEach(() => {
  mocks.store.clear();
  mocks.privateStateProvider.setContractAddress.mockClear();
  mocks.privateStateProvider.get.mockClear();
  mocks.privateStateProvider.set.mockClear();
  for (const flow of Object.values(mocks.flows)) {
    flow.mockReset();
  }
  mocks.contract.readState.mockClear();
  mocks.pureCircuits.holderBinding.mockClear();
  mocks.pureCircuits.computeVaultKey.mockClear();
  mocks.attestate.mockReset();
  mocks.flows.attestWorkout.mockResolvedValue({ vaultKey: bytes(5), tx: mocks.tx('0xattest') });
  mocks.flows.createWagerFlow.mockResolvedValue(mocks.tx('0xcreate'));
  mocks.flows.acceptWagerFlow.mockResolvedValue(mocks.tx('0xaccept'));
  mocks.flows.submitWorkoutFlow.mockResolvedValue(mocks.tx('0xsubmit'));
  mocks.flows.settleWagerFlow.mockResolvedValue(mocks.tx('0xsettle'));
  mocks.flows.advanceStreakFlow.mockResolvedValue(mocks.tx('0xstreak'));
  mocks.flows.mintBadgeFlow.mockResolvedValue(mocks.tx('0xbadge'));
  mocks.flows.proveBadgeFlow.mockResolvedValue(mocks.tx('0xprove'));
  mocks.attestate.mockImplementation(async () => mocks.notarizedValue);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('wallet bridge real adapter (P0/P1 regression)', () => {
  it('createWager flattens routing into flat payout/coinKey for createWagerFlow', async () => {
    const session = await sessionOf();
    const payout = bytes(1);
    const coinKey = { bytes: bytes(2) };
    await session.createWager({
      opponentBinding: 0x99n,
      metricId: 1n,
      stake: 10n ** 13n,
      deadlineBlock: 1754640090n,
      routing: { payout, coinKey },
    });

    expect(mocks.flows.createWagerFlow).toHaveBeenCalledTimes(1);
    const input = mocks.flows.createWagerFlow.mock.calls[0][1];
    expect(input).toEqual({
      opponentBinding: 0x99n,
      metricId: 1n,
      stake: 10n ** 13n,
      deadlineBlock: 1754640090n,
      payout,
      coinKey,
    });
    expect(input).not.toHaveProperty('routing');
  });

  it('submitWorkout passes the FULL attestation (assertion + signatures) to submitWorkoutFlow', async () => {
    const session = await sessionOf();
    const attestation = {
      assertion: { version: 1n },
      signatures: [{ announcement: { x: 1n, y: 2n }, response: 3n }],
      commitRand: bytes(3),
      vaultKey: bytes(4),
    };
    await session.submitWorkout(7n, attestation, 3900n);

    expect(mocks.flows.submitWorkoutFlow).toHaveBeenCalledTimes(1);
    expect(mocks.flows.submitWorkoutFlow).toHaveBeenCalledWith(
      expect.anything(),
      attestation, // the FULL object — not attestation.assertion (audit P0-B)
      attestation.commitRand,
      7n,
      attestation.vaultKey,
      3900n
    );
  });

  it('settleWager stages wagerOpenings challenger-first into the private state', async () => {
    const session = await sessionOf();
    const openings = {
      challenger: { value: 3900n, rand: bytes(0x11) },
      opponent: { value: 2426n, rand: bytes(0x22) },
    };
    await session.settleWager(7n, openings);

    expect(mocks.privateStateProvider.set).toHaveBeenCalledWith(
      'wf-test-store',
      expect.objectContaining({ wagerOpenings: [3900n, bytes(0x11), 2426n, bytes(0x22)] })
    );
    expect(mocks.flows.settleWagerFlow).toHaveBeenCalledWith(expect.anything(), 7n);
  });

  it('attest fans out to the NotaryClient with the artifacts and vaults the notarized assertion', async () => {
    const session = await sessionOf();
    const artifacts = { claim: { a: 1 }, claimSignatureHex: '0xaa', attestorAddress: '0xbb' };
    const result = await session.attest(artifacts);

    expect(mocks.attestate).toHaveBeenCalledWith(artifacts);
    expect(mocks.flows.attestWorkout).toHaveBeenCalledWith(
      expect.anything(),
      mocks.notarizedValue,
      expect.any(Uint8Array)
    );
    expect(result.txHash).toBe('0xattest');
    expect(result.vaultKey).toEqual(bytes(5));
    expect(result.metrics).toEqual([{ metricId: '0x1', label: 'distance', value: '3900' }]);
    expect(result.attestation.assertion).toBe(mocks.notarizedValue.assertion);
    expect(result.attestation.commitRand).toEqual(expect.any(Uint8Array));
  });

  it('holderBinding is the pureCircuits binding, formatted 0x + 64 hex', async () => {
    const session = await sessionOf();
    expect(session.holderBinding).toBe('0x' + 0x1234n.toString(16).padStart(64, '0'));
  });

  it('stagedVaultKey derives from the staged assertion — null when nothing staged', async () => {
    const session = await sessionOf();
    expect(await session.stagedVaultKey()).toBeNull();

    const commitRand = bytes(7);
    await mocks.privateStateProvider.set('wf-test-store', {
      assertion: { version: 1n, timestamp: 1754640000n },
      commitRand,
    });
    expect(await session.stagedVaultKey()).toEqual(commitRand);
    expect(mocks.pureCircuits.computeVaultKey).toHaveBeenCalledWith(
      { version: 1n, timestamp: 1754640000n },
      commitRand
    );
  });

  it('advanceStreak rejects a vault key that is not the staged attestation (audit P1)', async () => {
    const session = await sessionOf();
    const commitRand = bytes(7);
    await mocks.privateStateProvider.set('wf-test-store', {
      assertion: { version: 1n, timestamp: 1754640000n },
      commitRand,
    });

    await expect(session.advanceStreak(bytes(8))).rejects.toThrow(/not the staged attestation/);
    expect(mocks.flows.advanceStreakFlow).not.toHaveBeenCalled();

    const result = await session.advanceStreak(commitRand);
    expect(mocks.flows.advanceStreakFlow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assertion: { version: 1n, timestamp: 1754640000n },
        commitRand,
      }),
      commitRand,
      commitRand,
      1754640000n / 86400n
    );
    expect(result).toEqual({ streakCount: 0n, lastDay: 0n });
  });

  it('mintBadge rejects a mismatch and passes the staged key', async () => {
    const session = await sessionOf();
    const commitRand = bytes(7);
    await mocks.privateStateProvider.set('wf-test-store', {
      assertion: { version: 1n },
      commitRand,
    });

    await expect(session.mintBadge(1, bytes(8))).rejects.toThrow(/not the staged attestation/);
    expect(mocks.flows.mintBadgeFlow).not.toHaveBeenCalled();

    await session.mintBadge(1, commitRand);
    expect(mocks.flows.mintBadgeFlow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assertion: { version: 1n }, commitRand }),
      commitRand,
      1n,
      commitRand
    );
  });
});

// Regression: join must NOT overwrite a stored private state with the seed.
// findDeployedContract (midnight-js-contracts) OVERWRITES the entry at
// privateStateId whenever initialPrivateState is supplied — so every rejoin
// used to mint a fresh holder secret, silently undoing wallet-mode
// restore/resume across page reloads. join may only seed an EMPTY store.
import type { FoundContract } from "@midnight-ntwrk/midnight-js-contracts";
import {
  createPrivateState,
  type PrivateState,
  type StrideContractType,
} from "@witnessfitness/contract";
import { Observable } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inMemoryPrivateStateProvider } from "../src/in-memory-private-state-provider.js";
import { StrideContract, type StrideProviders } from "../src/index.js";

const mocks = vi.hoisted(() => ({
  findDeployedContract: vi.fn(),
}));

vi.mock("@midnight-ntwrk/midnight-js-contracts", () => ({
  findDeployedContract: mocks.findDeployedContract,
}));

const CONTRACT_ADDRESS = "0xabc";
const STORE = "wf-demo";

const fakeFound = () =>
  ({
    deployTxData: { public: { contractAddress: CONTRACT_ADDRESS } },
  }) as unknown as FoundContract<StrideContractType>;

const providersOf = (privateStateProvider: unknown): StrideProviders =>
  ({
    privateStateProvider,
    publicDataProvider: {
      contractStateObservable: () => new Observable(),
    },
  }) as unknown as StrideProviders;

const seed = (holderFill: number): PrivateState =>
  createPrivateState(new Uint8Array(32).fill(0xa1), new Uint8Array(32).fill(holderFill));

beforeEach(() => {
  mocks.findDeployedContract.mockReset();
  mocks.findDeployedContract.mockResolvedValue(fakeFound());
});

describe("StrideContract.join private-state seeding", () => {
  it("seeds a fresh private state when the store is empty", async () => {
    const provider = inMemoryPrivateStateProvider<string, PrivateState>();
    const expected = seed(0x11);
    await StrideContract.join(providersOf(provider), CONTRACT_ADDRESS, STORE, expected);

    const options = mocks.findDeployedContract.mock.calls[0][1] as {
      initialPrivateState?: PrivateState;
    };
    expect(options.initialPrivateState).toEqual(expected);
  });

  it("keeps the STORED private state on rejoin — the reload/restore regression", async () => {
    const provider = inMemoryPrivateStateProvider<string, PrivateState>();
    provider.setContractAddress(CONTRACT_ADDRESS);
    const stored = seed(0x22);
    await provider.set(STORE, stored);

    // A rejoin passes a DIFFERENT seed (browser.ts derives a fresh random
    // holder secret every page load) — join must never hand THAT seed to
    // findDeployedContract, which would overwrite the restored identity.
    await StrideContract.join(providersOf(provider), CONTRACT_ADDRESS, STORE, seed(0x33));

    const options = mocks.findDeployedContract.mock.calls[0][1] as {
      initialPrivateState?: PrivateState;
    };
    expect(options.initialPrivateState).toEqual(stored);
    expect(options.initialPrivateState?.holderSecret[0]).not.toBe(0x33);
    expect(await provider.get(STORE)).toEqual(stored);
  });

  it("resolveInitialPrivateState: stored wins, seed fills an empty store, both absent → undefined", async () => {
    const provider = inMemoryPrivateStateProvider<string, PrivateState>();
    const seeded = await StrideContract.resolveInitialPrivateState(
      providersOf(provider),
      CONTRACT_ADDRESS,
      STORE,
      seed(0x44),
    );
    expect(seeded).toEqual(seed(0x44));

    provider.setContractAddress(CONTRACT_ADDRESS);
    const stored = seed(0x55);
    await provider.set(STORE, stored);
    const kept = await StrideContract.resolveInitialPrivateState(
      providersOf(provider),
      CONTRACT_ADDRESS,
      STORE,
      seed(0x66),
    );
    expect(kept).toEqual(stored);

    const fresh = inMemoryPrivateStateProvider<string, PrivateState>();
    const none = await StrideContract.resolveInitialPrivateState(
      providersOf(fresh),
      CONTRACT_ADDRESS,
      STORE,
    );
    expect(none).toBeUndefined();
  });
});

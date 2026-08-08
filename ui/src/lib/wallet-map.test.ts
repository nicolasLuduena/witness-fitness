// P0-1 regression guard: the REAL bridge's readState returns the contract
// LEDGER's Map-like ADTs (member/lookup/iterator — per
// packages/contract/src/managed/stride/contract/index.d.ts: vault keys are
// Uint8Array → {holderBinding, timestamp}; streaks/badges keyed by holder
// binding, badges values are Set<bigint>). The stub bridge returns plain
// arrays, which is why this was never caught. These fixtures are constructed
// to the .d.ts contract and driven through the REAL WalletClient (bridge
// override) — vault/streak/badges/wagers must all map without throwing and
// filter by holder binding.

import type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LedgerMapLike } from "./state-mappers";
import type { WalletBridge, WalletStrideSession, WalletWagerView } from "./wallet-bridge";
import { WalletClient } from "./wallet-client";

// loadDeployInfo now fails LOUD when /deploy-output.json is missing (no
// silent FALLBACK constants) — wallet tests stub it with a fixed deployment.
vi.mock("./deploy-info", () => ({
  loadDeployInfo: vi.fn(async () => ({
    contractAddress: "0x" + "cf80ad42".padEnd(64, "0"),
    network: "local-devnet",
    notaryKeys: [
      { id: "notary-1", x: "0x3862", y: "0x43c0" },
      { id: "notary-2", x: "0x58da", y: "0x6633" },
      { id: "notary-3", x: "0x6b58", y: "0x19b5" },
    ],
  })),
  shortContract: (address: string) => address,
}));

// ------------------------------------------------------------ shims --------

const windowShim = {} as Window & { midnight?: Record<string, InitialAPI> };
(globalThis as { window?: unknown }).window = windowShim;

const storageBacking = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => storageBacking.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageBacking.set(key, value);
  },
  removeItem: (key: string) => {
    storageBacking.delete(key);
  },
  clear: () => storageBacking.clear(),
  key: (index: number) => Array.from(storageBacking.keys())[index] ?? null,
  get length() {
    return storageBacking.size;
  },
};

const createConnectedStub = (address: string): ConnectedAPI =>
  ({
    getConfiguration: async () => ({
      indexerUri: "http://localhost:8088/api/v4/graphql",
      indexerWsUri: "ws://localhost:8088/api/v4/graphql/ws",
      substrateNodeUri: "ws://localhost:9944",
      networkId: "undeployed",
    }),
    getConnectionStatus: async () => ({ status: "connected", networkId: "undeployed" }),
    getShieldedAddresses: async () => ({
      shieldedAddress: `mn_shield-${address}`,
      shieldedCoinPublicKey: `mn_cpk-${address}`,
      shieldedEncryptionPublicKey: `mn_epk-${address}`,
    }),
  }) as unknown as ConnectedAPI;

const setWindowMidnight = (wallets: Record<string, InitialAPI> | undefined): void => {
  if (wallets === undefined) delete windowShim.midnight;
  else windowShim.midnight = wallets;
};

// ------------------------------------------------------- ledger fixtures ----

const mapLike = <K, V>(entries: [K, V][]): LedgerMapLike<K, V> => {
  const map = new Map(entries);
  return {
    member: (key) => map.has(key),
    lookup: (key) => map.get(key) as V,
    [Symbol.iterator]: () => map[Symbol.iterator](),
  };
};

// The compiled `badges` ADT (Map<Field, Set<Uint8>>) exposes member/lookup
// but NO outer Symbol.iterator (codegen quirk for nested ADTs) — the guard
// must resolve it via member/lookup, never iteration.
const nestedMapLike = <K, V>(entries: [K, V][]): LedgerMapLike<K, V> => {
  const map = new Map(entries);
  return {
    member: (key) => map.has(key),
    lookup: (key) => map.get(key) as V,
  } as LedgerMapLike<K, V>;
};

const hexToBytes = (hex: string): Uint8Array => {
  const bare = hex.replace(/^0x/, "");
  const out = new Uint8Array(bare.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(bare.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

const MY_BINDING = "0x" + "ab".repeat(32);
const OTHER_BINDING = "0x" + "cd".repeat(32);
const MY_VAULT_KEY = "0x" + "11".repeat(32);
const OTHER_VAULT_KEY = "0x" + "22".repeat(32);
const NOW_UNIX = BigInt(Math.floor(Date.now() / 1000));

const stubSession = (): WalletStrideSession => ({
  contractAddress: "0xcf80ad42",
  holderBinding: MY_BINDING,
  readState: async () => ({
    // .d.ts contract: vault = Iterator<[Uint8Array, VaultEntry]>
    vault: mapLike<Uint8Array, { holderBinding: bigint; timestamp: bigint }>([
      [
        hexToBytes(MY_VAULT_KEY),
        { holderBinding: BigInt(MY_BINDING), timestamp: NOW_UNIX - 3600n },
      ],
      [hexToBytes(OTHER_VAULT_KEY), { holderBinding: BigInt(OTHER_BINDING), timestamp: NOW_UNIX }],
    ]),
    // .d.ts contract: streaks = Iterator<[bigint, Streak]>
    streaks: mapLike<bigint, { count: bigint; lastDay: bigint }>([
      [BigInt(MY_BINDING), { count: 2n, lastDay: NOW_UNIX / 86400n }],
      [BigInt(OTHER_BINDING), { count: 9n, lastDay: 0n }],
    ]),
    // .d.ts contract: badges = Iterator<[bigint, Set<bigint>]>
    badges: mapLike<bigint, Iterable<bigint>>([[BigInt(MY_BINDING), new Set([1n])]]),
  }),
  listWagers: async (): Promise<WalletWagerView[]> => [
    {
      id: 1n,
      challenger: BigInt(MY_BINDING),
      opponent: BigInt(OTHER_BINDING),
      metricId: 1n,
      stake: 10n * 10n ** 12n,
      deadlineBlock: NOW_UNIX + 90n,
      accepted: true,
      settled: false,
      challengerSubmission: { is_some: true, value: new Uint8Array(32).fill(7) },
      opponentSubmission: { is_some: false, value: new Uint8Array(32) },
    },
  ],
  attest: async () => {
    throw new Error("not used in the Map-shape regression test");
  },
  createWager: async () => {
    throw new Error("not used in the Map-shape regression test");
  },
  acceptWager: async () => {
    throw new Error("not used in the Map-shape regression test");
  },
  submitWorkout: async () => {
    throw new Error("not used in the Map-shape regression test");
  },
  settleWager: async () => {
    throw new Error("not used in the Map-shape regression test");
  },
  stageSubmissionRand: async () => {
    throw new Error("not used in the Map-shape regression test");
  },
  stagedVaultKey: async () => {
    throw new Error("not used in the Map-shape regression test");
  },
  advanceStreak: async () => {
    throw new Error("not used in the Map-shape regression test");
  },
  mintBadge: async () => {
    throw new Error("not used in the Map-shape regression test");
  },
  proveBadge: async () => {
    throw new Error("not used in the Map-shape regression test");
  },
});

const stubBridge = (): WalletBridge => ({
  initializeProviders: async () => ({}),
  exportPrivateState: async () => {
    throw new Error("not used");
  },
  importPrivateState: async () => {
    throw new Error("not used");
  },
  resetPrivateState: async () => {
    throw new Error("not used");
  },
  deriveBrowserHolderSecret: () => new Uint8Array(32),
  joinStrideFromBrowser: async () => stubSession(),
});

afterEach(() => {
  setWindowMidnight(undefined);
  storageBacking.clear();
});

// ---------------------------------------------------------------- tests ----

describe("wallet ledger Map-like readState (P0-1 regression)", () => {
  const connect = async (): Promise<WalletClient> => {
    setWindowMidnight({
      "com.test.wallet": {
        rdns: "com.test.wallet",
        name: "Test Wallet",
        icon: "data:image/png;base64,stub",
        apiVersion: "4.0.1",
        connect: async () => createConnectedStub("alice"),
      } as InitialAPI,
    });
    const client = new WalletClient(stubBridge());
    await client.connect();
    return client;
  };

  it("vault() maps Map-like entries and filters by holder binding", async () => {
    const client = await connect();
    const vault = await client.vault();
    expect(vault).toHaveLength(1);
    expect(vault[0].commitment).toBe(MY_VAULT_KEY);
    expect(vault[0].athlete.role).toBe("local");
  });

  it("streak() reads my binding\u2019s Map entry (not the other athlete\u2019s)", async () => {
    const client = await connect();
    const streak = await client.streak();
    expect(streak.current).toBe(2);
    expect(streak.lastDay).toBe(NOW_UNIX / 86400n);
  });

  it("badges() reads my binding\u2019s Set of badge ids", async () => {
    const client = await connect();
    const badges = await client.badges();
    expect(badges.find((b) => b.id === 1)?.minted).toBe(true);
    expect(badges.find((b) => b.id === 2)?.minted).toBe(false);
  });

  it("badges() resolves the compiled nested-ADT shape (no outer iterator)", async () => {
    const session = stubSession();
    session.readState = async () => ({
      ...(await stubSession().readState()),
      badges: nestedMapLike<bigint, Iterable<bigint>>([[BigInt(MY_BINDING), new Set([1n])]]),
    });
    const bridge = stubBridge();
    bridge.joinStrideFromBrowser = async () => session;
    setWindowMidnight({
      "com.test.wallet": {
        rdns: "com.test.wallet",
        name: "Test Wallet",
        icon: "data:image/png;base64,stub",
        apiVersion: "4.0.1",
        connect: async () => createConnectedStub("alice"),
      } as InitialAPI,
    });
    const client = new WalletClient(bridge);
    await client.connect();
    const badges = await client.badges();
    expect(badges.find((b) => b.id === 1)?.minted).toBe(true);
    expect(badges.find((b) => b.id === 2)?.minted).toBe(false);
  });

  it("listWagers() maps challenger/opponent by my binding and builds envelopes", async () => {
    const client = await connect();
    const wagers = await client.listWagers();
    expect(wagers).toHaveLength(1);
    expect(wagers[0].challenger.role).toBe("local");
    expect(wagers[0].opponent.role).toBe("opponent");
    expect(wagers[0].submissions).toHaveLength(1);
    expect(wagers[0].status).toBe("accepted");
    expect(wagers[0].stake).toBe(10);
  });
});

// Wallet-mode tests (Track 0.2): DApp Connector discovery/authorize happy
// path, no-wallet CTA, apiVersion + network guards, holder-secret store
// determinism, and the encrypted export/import roundtrip through the bridge
// stub. Stub shapes follow the dapp-connector-testing skill patterns.

import { afterEach, describe, expect, it } from "vitest";

// Vitest runs in node; the connector + tests touch window.midnight only.
const windowShim = {} as Window & { midnight?: Record<string, InitialAPI> };
(globalThis as { window?: unknown }).window = windowShim;
import type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import { connectWallet, discoverWalletSummaries, WalletUnavailableError } from "./wallet-connector";
import { createStubWalletBridge } from "./wallet-bridge";
import { walletStoreName } from "./wallet-client";
import {
  hasStoredBackup,
  performRestore,
  readStoredBackup,
  shouldAutoResume,
  storeBackupPayload,
  walletBackupKey,
} from "./wallet-restore";
import { vaultEntriesOf } from "./state-mappers";

interface StubWalletOptions {
  apiVersion?: string;
  networkId?: string;
  connectError?: Error;
  address?: string;
  rdns?: string;
  name?: string;
}

const createConnectedStub = (opts: StubWalletOptions): ConnectedAPI =>
  ({
    getConfiguration: async () => ({
      indexerUri: "http://localhost:8088/api/v4/graphql",
      indexerWsUri: "ws://localhost:8088/api/v4/graphql/ws",
      substrateNodeUri: "ws://localhost:9944",
      networkId: opts.networkId ?? "undeployed",
    }),
    getConnectionStatus: async () => ({
      status: "connected",
      networkId: opts.networkId ?? "undeployed",
    }),
    getShieldedAddresses: async () => ({
      shieldedAddress: `mn_shield-${opts.address ?? "alice"}`,
      shieldedCoinPublicKey: `mn_cpk-${opts.address ?? "alice"}`,
      shieldedEncryptionPublicKey: `mn_epk-${opts.address ?? "alice"}`,
    }),
    getUnshieldedAddress: async () => ({ unshieldedAddress: "mn_addr-test" }),
    getDustAddress: async () => ({ dustAddress: "mn_dust-test" }),
    getShieldedBalances: async () => ({}),
    getUnshieldedBalances: async () => ({}),
    getDustBalance: async () => ({ cap: 0n, balance: 0n }),
    getTxHistory: async () => [],
    submitTransaction: async () => undefined,
    balanceUnsealedTransaction: async (tx: string) => ({ tx }),
    makeTransfer: async () => ({ tx: "stub-transfer" }),
    signData: async () => "stub-sig",
    getProvingProvider: async () => undefined,
  }) as unknown as ConnectedAPI;

const createWalletStub = (opts: StubWalletOptions = {}): InitialAPI =>
  ({
    rdns: opts.rdns ?? "com.test.wallet",
    name: opts.name ?? "Test Wallet",
    icon: "data:image/png;base64,stub",
    apiVersion: opts.apiVersion ?? "4.0.1",
    connect: async () => {
      if (opts.connectError) throw opts.connectError;
      return createConnectedStub(opts);
    },
  }) as InitialAPI;

const setWindowMidnight = (wallets: Record<string, InitialAPI> | undefined): void => {
  if (wallets === undefined) {
    delete windowShim.midnight;
  } else {
    windowShim.midnight = wallets;
  }
};

afterEach(() => {
  setWindowMidnight(undefined);
});

describe("wallet connector", () => {
  it("discovers the wallet and authorizes (happy path)", async () => {
    setWindowMidnight({ "com.test.wallet": createWalletStub({ address: "alice" }) });
    const connection = await connectWallet("undeployed");
    expect(connection.apiVersion).toBe("4.0.1");
    expect(connection.networkId).toBe("undeployed");
    expect(connection.coinPublicKey).toBe("mn_cpk-alice");
    expect(connection.shieldedAddress).toContain("mn_shield");
  });

  it("no wallet installed → switch-to-demo error", async () => {
    setWindowMidnight(undefined);
    await expect(connectWallet("undeployed")).rejects.toThrow(WalletUnavailableError);
    await expect(connectWallet("undeployed")).rejects.toThrow(/install a wallet extension/);
  });

  it("apiVersion too old → rejected with CTA", async () => {
    setWindowMidnight({ "com.test.wallet": createWalletStub({ apiVersion: "2.0.0" }) });
    await expect(connectWallet("undeployed")).rejects.toThrow(/too old/);
  });

  it("network mismatch vs the devnet → rejected with CTA", async () => {
    setWindowMidnight({ "com.test.wallet": createWalletStub({ networkId: "testnet" }) });
    await expect(connectWallet("undeployed")).rejects.toThrow(/network "testnet"/);
  });

  it("multi-wallet: connectWallet(rdns) picks the requested wallet", async () => {
    setWindowMidnight({
      "io.lace.wallet": createWalletStub({ address: "lace", rdns: "io.lace.wallet", name: "Lace" }),
      "io.oneam.wallet": createWalletStub({
        address: "oneam",
        rdns: "io.oneam.wallet",
        name: "1am",
      }),
    });
    const lace = await connectWallet("undeployed", "io.lace.wallet");
    expect(lace.rdns).toBe("io.lace.wallet");
    expect(lace.name).toBe("Lace");
    expect(lace.coinPublicKey).toBe("mn_cpk-lace");
    const oneam = await connectWallet("undeployed", "io.oneam.wallet");
    expect(oneam.rdns).toBe("io.oneam.wallet");
    expect(oneam.coinPublicKey).toBe("mn_cpk-oneam");
  });

  it("multi-wallet: unknown rdns → clear error", async () => {
    setWindowMidnight({ "io.lace.wallet": createWalletStub({ address: "lace" }) });
    await expect(connectWallet("undeployed", "io.ghost.wallet")).rejects.toThrow(/not found/);
  });

  it("discoverWalletSummaries lists all installed wallets with metadata", () => {
    setWindowMidnight({
      "io.lace.wallet": createWalletStub({ address: "lace", rdns: "io.lace.wallet", name: "Lace" }),
      "io.oneam.wallet": createWalletStub({
        address: "oneam",
        rdns: "io.oneam.wallet",
        name: "1am",
      }),
    });
    const summaries = discoverWalletSummaries();
    expect(summaries.map((w) => w.name)).toEqual(["Lace", "1am"]);
    expect(summaries[0].rdns).toBe("io.lace.wallet");
    expect(summaries[0].apiVersion).toBe("4.0.1");
    expect(summaries[0].icon).toContain("data:image");
  });
});

describe("wallet bridge stub", () => {
  it("holder-secret store is deterministic per wallet address", () => {
    expect(walletStoreName("mn_cpk-alice")).toBe(walletStoreName("mn_cpk-alice"));
    expect(walletStoreName("mn_cpk-alice")).not.toBe(walletStoreName("mn_cpk-bob"));
    expect(walletStoreName("mn_cpk-alice")).toMatch(/^wf-wallet-/);
  });

  it("deriveBrowserHolderSecret returns 32 random bytes; stability comes from persistence", async () => {
    const bridge = createStubWalletBridge();
    const alice = createConnectedStub({ address: "alice" });
    await bridge.initializeProviders(alice);
    const secret = bridge.deriveBrowserHolderSecret();
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(secret.length).toBe(32);
    // The real api/browser deriveBrowserHolderSecret is random per call —
    // determinism across reloads comes from the persisted private state
    // (export/import roundtrip), never from re-derivation.
    const fresh = bridge.deriveBrowserHolderSecret();
    expect(Array.from(fresh)).not.toEqual(Array.from(secret));
  });

  it("export/import roundtrip preserves the private state; wrong password fails", async () => {
    const alice = createConnectedStub({ address: "alice" });
    const bridge = createStubWalletBridge();
    await bridge.initializeProviders(alice);
    const session = await bridge.joinStrideFromBrowser(alice, "0xcontract", "wf-test-store");
    await session.attest({
      claim: {},
      signatureHex: "0x00",
      attestorAddress: "0xattestor",
      responseText: 'HTTP/1.1 200 OK\r\n\r\n{"distance": 3900}',
    });

    const payload = await bridge.exportPrivateState("pw-123", "wf-test-store");
    expect(typeof payload).toBe("string");
    expect(payload.length).toBeGreaterThan(0);

    // fresh bridge → restore → state is back
    const bridge2 = createStubWalletBridge();
    await bridge2.importPrivateState("pw-123", "wf-test-store", payload);
    const session2 = await bridge2.joinStrideFromBrowser(alice, "0xcontract", "wf-test-store");
    const state2 = await session2.readState();
    expect(vaultEntriesOf(state2.vault)).toHaveLength(1);

    // wrong password on a fresh bridge → rejected
    const bridge3 = createStubWalletBridge();
    await expect(bridge3.importPrivateState("wrong", "wf-test-store", payload)).rejects.toThrow(
      /wrong backup password/,
    );
  });

  it("reset clears the stored private state", async () => {
    const alice = createConnectedStub({ address: "alice" });
    const bridge = createStubWalletBridge();
    const session = await bridge.joinStrideFromBrowser(alice, "0xcontract", "wf-test-store");
    await session.attest({ claim: {}, signatureHex: "0x00", attestorAddress: "0xa" });
    await bridge.resetPrivateState("wf-test-store");
    await expect(bridge.exportPrivateState("pw", "wf-test-store")).rejects.toThrow(
      /no private state/,
    );
  });
});

// --------------------------------------------------------------- restore ----
// Wallet-mode restore/resume helpers (Track 0.2 polish): the backup lives in
// localStorage; restore always loads the payload from storage, never from
// user input; auto-resume prompts only when appropriate.

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

describe("wallet restore/resume helpers", () => {
  afterEach(() => {
    storageBacking.clear();
  });

  it("backup key is deterministic per wallet address", () => {
    const alice = "mn_shield-addr-ALICE1234567890abcdef";
    const bob = "mn_shield-addr-BOB0000000000000000";
    expect(walletBackupKey(alice)).toBe(walletBackupKey(alice));
    expect(walletBackupKey(alice)).not.toBe(walletBackupKey(bob));
    expect(walletBackupKey(alice)).toMatch(/^wf-wallet-backup-/);
  });

  it("store/read/has roundtrip for the stored backup", () => {
    const address = "mn_shield-addr-ALICE1234567890abcdef";
    expect(hasStoredBackup(address)).toBe(false);
    storeBackupPayload(address, "encrypted-payload");
    expect(hasStoredBackup(address)).toBe(true);
    expect(readStoredBackup(address)).toBe("encrypted-payload");
    expect(localStorage.getItem(walletBackupKey(address))).toBe("encrypted-payload");
  });

  it("performRestore calls the bridge with the STORED payload, not user input", async () => {
    const address = "mn_shield-addr-ALICE1234567890abcdef";
    storeBackupPayload(address, "stored-encrypted-payload");

    const calls: Array<{ password: string; payload: string }> = [];
    const restorePrivateState = async (password: string, payload: string): Promise<void> => {
      calls.push({ password, payload });
    };

    await performRestore({ address, password: "pw-123", restorePrivateState });
    expect(calls).toEqual([{ password: "pw-123", payload: "stored-encrypted-payload" }]);
  });

  it("performRestore rejects when no backup is stored (button-disabled state)", async () => {
    const restorePrivateState = async (): Promise<void> => {
      throw new Error("must not be called");
    };
    await expect(
      performRestore({ address: "mn_shield-addr-NOBACKUP", password: "pw", restorePrivateState }),
    ).rejects.toThrow(/no backup stored/);
  });

  it("wrong password does not wipe the stored backup", async () => {
    const address = "mn_shield-addr-ALICE1234567890abcdef";
    storeBackupPayload(address, "precious-payload");
    const restorePrivateState = async (): Promise<void> => {
      throw new Error("wrong backup password");
    };
    await expect(
      performRestore({ address, password: "wrong", restorePrivateState }),
    ).rejects.toThrow(/wrong backup password/);
    expect(hasStoredBackup(address)).toBe(true);
    expect(readStoredBackup(address)).toBe("precious-payload");
  });

  it("auto-resume prompts only when a backup exists, no live session, not prompted yet", () => {
    expect(
      shouldAutoResume({ hasBackup: true, hasCredentials: false, alreadyPrompted: false }),
    ).toBe(true);
    expect(
      shouldAutoResume({ hasBackup: false, hasCredentials: false, alreadyPrompted: false }),
    ).toBe(false);
    expect(
      shouldAutoResume({ hasBackup: true, hasCredentials: true, alreadyPrompted: false }),
    ).toBe(false);
    expect(
      shouldAutoResume({ hasBackup: true, hasCredentials: false, alreadyPrompted: true }),
    ).toBe(false);
  });
});

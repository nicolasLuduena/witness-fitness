// Round 2D wallet-mode tests: the REAL browser demo path — Strava OAuth
// surface (connect/redirect/identity), the real attestation flow (guard →
// attestStrava → notary bridge), and the two-browser wager flow (create by
// holder-binding ID, sealed submissions with deterministic submissionRand,
// opening relay at submit, settle with staged openings + reveal). The bridge
// is the shared stub; the attestation module's attestStrava is mocked (its
// attestor-core websocket path is exercised live); the service + Strava APIs
// are stubbed via globalThis.fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowShim = {
  location: { href: "http://localhost:5173/", origin: "http://localhost:5173" },
  history: {
    replaceState: (_state: unknown, _title: string, url?: string) => {
      if (url) windowShim.location.href = url;
    },
  },
} as unknown as Window & { midnight?: Record<string, InitialAPI> };
(globalThis as { window?: unknown }).window = windowShim;

const storageBacking = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => storageBacking.get(key) ?? null,
  setItem: (key: string, value: string) => void storageBacking.set(key, value),
  removeItem: (key: string) => void storageBacking.delete(key),
  clear: () => storageBacking.clear(),
};

import type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import { attestStrava } from "./attest/attest-browser";
import { localStorageTokenStore } from "./attest/strava";
import { createStubWalletBridge, type WalletBridge } from "./wallet-bridge";
import { StravaFlowError, WalletClient } from "./wallet-client";

// A REAL bech32m unshielded address for the 'undeployed' network (32 bytes of
// 0x07 — precomputed with UnshieldedAddress.codec.encode; hardcoded because
// the encode path differs under the vitest Buffer polyfill). The wallet-client
// decodes it back to 32 bytes for the wager payout routing.
const TEST_UNSHIELDED =
  "mn_addr_undeployed1qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qursn4yfte";

vi.mock("./attest/attest-browser", async (importOriginal) => {
  const mod = (await importOriginal()) as typeof import("./attest/attest-browser");
  return { ...mod, attestStrava: vi.fn() };
});

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

const attestStravaMock = vi.mocked(attestStrava);

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }) as Response;

const createConnectedStub = (opts: { address?: string; unshielded?: string } = {}): ConnectedAPI =>
  ({
    getConfiguration: async () => ({
      indexerUri: "http://localhost:8088/api/v4/graphql",
      indexerWsUri: "ws://localhost:8088/api/v4/graphql/ws",
      substrateNodeUri: "ws://localhost:9944",
      networkId: "undeployed",
    }),
    getConnectionStatus: async () => ({ status: "connected", networkId: "undeployed" }),
    getShieldedAddresses: async () => ({
      shieldedAddress: `mn_shield-${opts.address ?? "alice"}`,
      // 64-hex coin public key (wallet-SDK style) — decoded to 32 bytes by the client
      shieldedCoinPublicKey: hexKey(opts.address ?? "alice"),
      shieldedEncryptionPublicKey: `mn_epk-${opts.address ?? "alice"}`,
    }),
    getUnshieldedAddress: async () => ({
      unshieldedAddress: opts.unshielded ?? TEST_UNSHIELDED,
    }),
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

const createWalletStub = (opts: { address?: string } = {}): InitialAPI =>
  ({
    rdns: "com.test.wallet",
    name: "Test Wallet",
    icon: "data:image/png;base64,stub",
    apiVersion: "4.0.1",
    connect: async () => createConnectedStub(opts),
  }) as InitialAPI;

// Deterministic 64-hex coin public key per wallet address — distinct wallets
// get distinct private-state stores + holder bindings (the two-browser flow).
const hexKey = (name: string): string => {
  let h = 0x811c9dc5;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return "0x" + h.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
};

const setWindowMidnight = (wallets: Record<string, InitialAPI> | undefined): void => {
  if (wallets === undefined) {
    delete windowShim.midnight;
  } else {
    windowShim.midnight = wallets;
  }
};

// A realistic attestStrava result (the notary transformProof shape).
const attestResult = (distance: number) => ({
  claim: {
    claim: { identifier: "0xid" },
    signatures: {
      attestorAddress: "0x" + "12".repeat(20),
      claimSignature: new Uint8Array(65),
      resultSignature: new Uint8Array(65),
    },
  },
  proof: {
    claimData: { identifier: "0xid" },
    identifier: "0xid",
    signatures: ["0x" + "ab".repeat(65)],
    extractedParameterValues: {
      data: `HTTP/1.1 200 OK\r\n\r\n[{"id": 1, "distance": ${distance}, "moving_time": 100}]`,
    },
    witnesses: [{ id: "0x" + "cd".repeat(40), url: "ws://localhost:8001/ws" }],
  },
});

const stravaTokens = (firstname = "Ada", lastname = "Lovelace", stravaId = 42) => ({
  access_token: "acc-live",
  refresh_token: "ref-live",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  athlete: { id: stravaId, firstname, lastname },
});

const sharedBridge = createStubWalletBridge();

const connectClient = async (address: string, bridge: WalletBridge = sharedBridge) => {
  setWindowMidnight({ "com.test.wallet": createWalletStub({ address }) });
  const client = new WalletClient(bridge);
  const session = await client.connect();
  return { client, session };
};

beforeEach(() => {
  attestStravaMock.mockReset();
  storageBacking.clear();
  setWindowMidnight({ "com.test.wallet": createWalletStub({ address: "alice" }) });
});

afterEach(() => {
  setWindowMidnight(undefined);
});

describe("strava oauth surface (wallet mode)", () => {
  it("connect() surfaces the Strava athlete identity from the token store", async () => {
    localStorageTokenStore.save(stravaTokens("Nicolás", "Ludueña", 1390331368));
    const { session } = await connectClient("alice");
    expect(session.athlete.name).toBe("Nicolás Ludueña");
    expect(session.athlete.handle).toBe("strava:1390331368");
    expect(session.athlete.holderBinding).toMatch(/^0x[0-9a-f]{64}$/);
    expect(session.walletConnected).toBe(true);
  });

  it("connect() falls back to a generic identity without Strava tokens", async () => {
    const { session } = await connectClient("alice");
    expect(session.athlete.name).toBe("Wallet athlete");
  });

  it("connectStrava() opens the Strava authorize URL with the callback path", async () => {
    const { client } = await connectClient("alice");
    client.connectStrava();
    const url = windowShim.location.href;
    expect(url).toContain("https://www.strava.com/oauth/authorize");
    expect(url).toContain(
      "redirect_uri=" + encodeURIComponent("http://localhost:5173/strava/callback"),
    );
    expect(url).toContain("scope=read%2Cactivity%3Aread_all");
    // never a client secret in the URL
    expect(url).not.toContain("client_secret");
  });

  it("handleStravaRedirect() exchanges the code and persists the identity", async () => {
    windowShim.location.href =
      "http://localhost:5173/strava/callback?code=oauth-code-123&scope=read";
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        access_token: "acc-new",
        refresh_token: "ref-new",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        athlete: { id: 7, firstname: "Grace", lastname: "Hopper" },
      }),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const { client } = await connectClient("alice");
    const handled = await client.handleStravaRedirect!();
    expect(handled).toBe(true);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const exchangeCall = calls.find((call) => call[0].endsWith("/strava/exchange"));
    expect(exchangeCall).toBeDefined();
    expect(JSON.parse(String(exchangeCall![1].body))).toEqual({ code: "oauth-code-123" });
    expect(client.stravaStatus!()).toEqual({
      connected: true,
      athleteName: "Grace Hopper",
      stravaId: 7,
    });
    expect(windowShim.location.href).toBe("http://localhost:5173");
  });

  it("handleStravaRedirect() is a no-op without a code", async () => {
    windowShim.location.href = "http://localhost:5173/";
    const fetchMock = vi.fn(async () => jsonResponse({}, 404));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { client } = await connectClient("alice");
    const handled = await client.handleStravaRedirect!();
    expect(handled).toBe(false);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.some((call) => call[0].includes("/strava/exchange"))).toBe(false);
  });
});

describe("attest — the real browser flow", () => {
  it("requires a connected Strava account first", async () => {
    const { client } = await connectClient("alice");
    await expect(client.attest()).rejects.toThrow(StravaFlowError);
    await expect(client.attest()).rejects.toMatchObject({ code: "strava-auth-required" });
  });

  it("blocks attestation for an empty Strava account (guard gating)", async () => {
    localStorageTokenStore.save(stravaTokens());
    const fetchMock = vi.fn(async () => jsonResponse([]));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { client } = await connectClient("alice");
    await expect(client.attest()).rejects.toThrow(StravaFlowError);
    await expect(client.attest()).rejects.toThrow(/no activities/);
    expect(attestStravaMock).not.toHaveBeenCalled();
  });

  it("runs the full staged pipeline and vaults a real credential", async () => {
    localStorageTokenStore.save(stravaTokens());
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => jsonResponse([{ id: 1 }]));
    attestStravaMock.mockResolvedValue(attestResult(3900) as never);
    const { client } = await connectClient("alice");

    const outcome = await client.attest();
    expect(outcome.replayed).toBe(false);
    expect(outcome.credential.athlete.name).toBe("Ada Lovelace");
    expect(outcome.credential.source).toBe("live-session");
    expect(outcome.credential.notarySignatures).toBe(2);
    expect(outcome.credential.value).toBe(3900);
    expect(outcome.credential.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const stageIds = outcome.stages.map((s) => s.id);
    expect(stageIds).toEqual(["guard", "tls", "notarize", "chain"]);
    expect(outcome.stages.every((s) => s.state === "done")).toBe(true);
    // the artifacts reached the bridge with the notary ProofArtifacts shape
    expect(attestStravaMock).toHaveBeenCalledWith("acc-live");

    // a second attestation with a different workout keeps both credentials
    attestStravaMock.mockResolvedValue(attestResult(2426) as never);
    const second = await client.attest();
    expect(second.credential.value).toBe(2426);
  });
});

describe("two-browser wager flow (create → accept → submit → relay → settle)", () => {
  const relayOpenings = new Map<number, { who: string; value: string; rand: string }[]>();
  let relayFetch: ReturnType<typeof vi.fn>;

  const setupRelay = () => {
    relayOpenings.clear();
    relayFetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://www.strava.com/api/v3/athlete/activities")) {
        return jsonResponse([{ id: 1, distance: 1000 }]);
      }
      if (u.endsWith("/wager-openings") && init?.method === "POST") {
        // Strict-fake relay: mirror the sidecar's /wager-openings validation
        // (demo-sidecar.ts handleOpeningsDeposit) so a wire-shape drift like
        // the numeric-wagerId bug fails the duel test loudly.
        const body = JSON.parse(String(init.body)) as {
          wagerId: unknown;
          who: string;
          value: string;
          rand: string;
        };
        if (
          typeof body.wagerId !== "string" ||
          body.wagerId === "" ||
          (body.who !== "A" && body.who !== "B") ||
          typeof body.value !== "string" ||
          typeof body.rand !== "string" ||
          !/^0x[0-9a-f]+$/i.test(body.value) ||
          !/^0x[0-9a-f]+$/i.test(body.rand)
        ) {
          return jsonResponse(
            { error: 'body must be { wagerId, who: "A"|"B", value: 0x-hex, rand: 0x-hex }' },
            400,
          );
        }
        const list = relayOpenings.get(Number(body.wagerId)) ?? [];
        list.push({ who: body.who, value: body.value, rand: body.rand });
        relayOpenings.set(Number(body.wagerId), list);
        return jsonResponse({ stored: true });
      }
      const match = u.match(/\/wager-openings\/(\d+)$/);
      if (match) return jsonResponse({ openings: relayOpenings.get(Number(match[1])) ?? [] });
      return jsonResponse({}, 404);
    });
    (globalThis as { fetch?: unknown }).fetch = relayFetch;
  };

  const attestBoth = async (clientA: WalletClient, clientB: WalletClient) => {
    attestStravaMock.mockResolvedValueOnce(attestResult(3900) as never);
    await clientA.attest();
    attestStravaMock.mockResolvedValueOnce(attestResult(2426) as never);
    await clientB.attest();
  };

  it("creates by holder-binding ID and maps roles per wallet", async () => {
    setupRelay();
    localStorageTokenStore.save(stravaTokens("Nicolás", "Ludueña", 1));
    const { client: clientA, session: sessionA } = await connectClient("alice");
    localStorageTokenStore.save(stravaTokens("Milo", "Chen", 2));
    const { client: clientB, session: sessionB } = await connectClient("bob");

    const created = await clientA.createWager({
      opponent: {
        name: "opponent",
        handle: "opponent",
        role: "opponent",
        holderBinding: sessionB.athlete.holderBinding,
      },
      metricId: 1n,
      stake: 10,
      deadlineBlock: BigInt(Math.floor(Date.now() / 1000) + 90),
    });
    expect(created.status).toBe("open");
    expect(created.stake).toBe(10);
    // A's view: challenger = me (dynamic Strava name), opponent = synthetic
    expect(created.challenger.role).toBe("local");
    expect(created.challenger.name).toBe("Nicolás Ludueña");
    expect(created.opponent.holderBinding).toBe(sessionB.athlete.holderBinding);

    // B's view: the wager now lists with B as the opponent (local)
    const bView = (await clientB.listWagers())[0];
    expect(bView.opponent.role).toBe("local");
    expect(bView.opponent.name).toBe("Milo Chen");
    expect(bView.challenger.holderBinding).toBe(sessionA.athlete.holderBinding);

    // invalid challenge IDs are rejected up front
    await expect(
      clientA.createWager({
        opponent: { name: "x", handle: "x", role: "opponent", holderBinding: "not-a-binding" },
        metricId: 1n,
        stake: 1,
        deadlineBlock: 0n,
      }),
    ).rejects.toThrow(/64-hex holder binding/);
  });

  it("runs the full duel: create → accept → seal both → relay → settle reveal", async () => {
    setupRelay();
    localStorageTokenStore.save(stravaTokens("Nicolás", "Ludueña", 1));
    const { client: clientA, session: sessionA } = await connectClient("alice");
    localStorageTokenStore.save(stravaTokens("Milo", "Chen", 2));
    const { client: clientB, session: sessionB } = await connectClient("bob");
    await attestBoth(clientA, clientB);

    const created = await clientA.createWager({
      opponent: {
        name: "opponent",
        handle: "opponent",
        role: "opponent",
        holderBinding: sessionB.athlete.holderBinding,
      },
      metricId: 1n,
      stake: 10,
      deadlineBlock: BigInt(Math.floor(Date.now() / 1000) + 90),
    });
    const wagerId = created.id;
    expect(sessionA.athlete.holderBinding).not.toBe(sessionB.athlete.holderBinding);

    // B accepts from their own wallet
    const accepted = await clientB.acceptWager(wagerId);
    expect(accepted.status).toBe("accepted");

    // both athletes seal their own submissions — each relayed immediately
    const afterA = await clientA.submitWorkout(wagerId, (await clientA.vault())[0].id);
    expect(afterA.submissions).toHaveLength(1);
    const afterB = await clientB.submitWorkout(wagerId, (await clientB.vault())[0].id);
    expect(afterB.submissions).toHaveLength(2);
    expect(afterB.status).toBe("submitted");
    // relay got both openings (A = challenger, B = opponent), rands in hex
    const relayed = relayOpenings.get(wagerId)!;
    expect(relayed.map((o) => o.who).sort()).toEqual(["A", "B"]);
    expect(
      relayed.every((o) => /^0x[0-9a-f]+$/.test(o.value) && /^0x[0-9a-f]+$/.test(o.rand)),
    ).toBe(true);
    // the sealed values are the real distances — but never in the view
    expect(afterB.submissions.every((s) => s.sealed)).toBe(true);
    expect(afterB.submissions.some((s) => s.value !== undefined)).toBe(false);

    // A settles: relays again (idempotent), waits for both, stages + settles
    const result = await clientA.settleWager(wagerId);
    expect(result.reveal.sealedForRoom).toBe(true);
    expect(result.reveal.comparison).toEqual({ challengerValue: 3900, opponentValue: 2426 });
    const settled = result.wager;
    expect(settled.status).toBe("settled");
    expect(settled.result?.winner?.name).toBe("Nicolás Ludueña");
    expect(settled.result?.currency).toBe("NIGHT");
    expect(settled.result?.pot).toBe(20);
    expect(settled.result?.disclosed).toBe(true);
    expect(settled.result?.summary).toContain("wins 20 NIGHT");

    // The losing side's browser did NOT settle (only the settler stages the
    // openings), and the ledger stores only sealed commitments — so their
    // view reports the settlement WITHOUT values or a winner (audit P1-F:
    // never present commitments as values). Winner identity stays sealed.
    const bView = (await clientB.listWagers()).find((w) => w.id === wagerId);
    expect(bView?.result?.disclosed).toBe(false);
    expect(bView?.result?.winner).toBeUndefined();
    expect(bView?.result?.challengerValue).toBeUndefined();
    expect(bView?.result?.opponentValue).toBeUndefined();
    expect(bView?.result?.summary).toContain("both sealed submissions counted");
  });

  it("settles from a fresh client (page reload) by recovering my opening from the relay", async () => {
    setupRelay();
    localStorageTokenStore.save(stravaTokens("A", "One", 1));
    const { client: clientA, session: sessionA } = await connectClient("alice");
    localStorageTokenStore.save(stravaTokens("B", "Two", 2));
    const { client: clientB, session: sessionB } = await connectClient("bob");
    await attestBoth(clientA, clientB);
    const created = await clientA.createWager({
      opponent: {
        name: "opponent",
        handle: "opponent",
        role: "opponent",
        holderBinding: sessionB.athlete.holderBinding,
      },
      metricId: 1n,
      stake: 5,
      deadlineBlock: BigInt(Math.floor(Date.now() / 1000) + 90),
    });
    const wagerId = created.id;
    await clientB.acceptWager(wagerId);
    await clientA.submitWorkout(wagerId, (await clientA.vault())[0].id);
    await clientB.submitWorkout(wagerId, (await clientB.vault())[0].id);

    // Simulate a reload: a NEW WalletClient for the same wallet/bridge —
    // its session-only `openings` map is empty, so settle must recover
    // A's opening from the relay (both sides posted at submit time).
    const { client: freshA } = await connectClient("alice");
    const result = await freshA.settleWager(wagerId);
    expect(result.reveal.comparison).toEqual({ challengerValue: 3900, opponentValue: 2426 });
    expect(result.wager.status).toBe("settled");
    // The winner is the challenger (A) — the fresh client sees itself as the
    // challenger (same holder binding); the shared test localStorage carries
    // B's Strava tokens, so assert by binding, not by name.
    expect(result.wager.result?.winner?.holderBinding).toBe(sessionA.athlete.holderBinding);
  });

  it("settles a both-gave-up wager as a refund (no openings needed)", async () => {
    setupRelay();
    localStorageTokenStore.save(stravaTokens("A", "One", 1));
    const { client: clientA, session: sessionA } = await connectClient("alice");
    localStorageTokenStore.save(stravaTokens("B", "Two", 2));
    const { client: clientB, session: sessionB } = await connectClient("bob");
    const created = await clientA.createWager({
      opponent: {
        name: "opponent",
        handle: "opponent",
        role: "opponent",
        holderBinding: sessionB.athlete.holderBinding,
      },
      metricId: 1n,
      stake: 5,
      deadlineBlock: BigInt(Math.floor(Date.now() / 1000) + 90),
    });
    void sessionA;
    await clientB.acceptWager(created.id);
    // neither side submits — either side can settle for the refund
    const result = await clientA.settleWager(created.id);
    expect(result.wager.status).toBe("settled");
    expect(result.wager.result?.forfeit).toBe(false);
    expect(result.wager.result?.winner).toBeUndefined();
    expect(result.wager.result?.summary).toContain("Neither submitted — both stakes refunded");
    expect(result.reveal.comparison).toBeUndefined();
  });

  it("settles a one-sided wager as a forfeit to the submitter (opponent browser settles)", async () => {
    setupRelay();
    localStorageTokenStore.save(stravaTokens("A", "One", 1));
    const { client: clientA, session: sessionA } = await connectClient("alice");
    localStorageTokenStore.save(stravaTokens("B", "Two", 2));
    const { client: clientB, session: sessionB } = await connectClient("bob");
    await attestBoth(clientA, clientB);
    const created = await clientA.createWager({
      opponent: {
        name: "opponent",
        handle: "opponent",
        role: "opponent",
        holderBinding: sessionB.athlete.holderBinding,
      },
      metricId: 1n,
      stake: 5,
      deadlineBlock: BigInt(Math.floor(Date.now() / 1000) + 90),
    });
    const wagerId = created.id;
    await clientB.acceptWager(wagerId);
    // only A submits — B (no local opening) settles → forfeit to A
    await clientA.submitWorkout(wagerId, (await clientA.vault())[0].id);
    const result = await clientB.settleWager(wagerId);
    expect(result.wager.status).toBe("settled");
    expect(result.wager.result?.forfeit).toBe(true);
    expect(result.wager.result?.winner?.holderBinding).toBe(sessionA.athlete.holderBinding);
    expect(result.wager.result?.summary).toContain("by forfeit");
    expect(result.reveal.comparison).toBeUndefined();
  });

  it("settles as a forfeit when the opponent never submits (their opening never relays)", async () => {
    setupRelay();
    localStorageTokenStore.save(stravaTokens("A", "One", 1));
    const { client: clientA, session: sessionA } = await connectClient("alice");
    localStorageTokenStore.save(stravaTokens("B", "Two", 2));
    const { client: clientB, session: sessionB } = await connectClient("bob");
    void sessionA;
    void sessionB;
    await attestBoth(clientA, clientB);
    const created = await clientA.createWager({
      opponent: {
        name: "opponent",
        handle: "opponent",
        role: "opponent",
        holderBinding:
          sessionA.athlete.holderBinding === "0x0" ? "0x1" : sessionB.athlete.holderBinding,
      },
      metricId: 1n,
      stake: 1,
      deadlineBlock: BigInt(Math.floor(Date.now() / 1000) + 90),
    });
    const wagerId = created.id;
    await clientB.acceptWager(wagerId);
    // only A submits — B never seals, so only A's opening is relayed
    await clientA.submitWorkout(wagerId, (await clientA.vault())[0].id);
    // one-sided wagers settle by forfeit — the relay wait is skipped entirely
    const result = await clientA.settleWager(wagerId);
    expect(result.wager.status).toBe("settled");
    expect(result.wager.result?.forfeit).toBe(true);
    expect(result.wager.result?.winner?.holderBinding).toBe(sessionA.athlete.holderBinding);
    expect(relayOpenings.get(wagerId)?.map((o) => o.who)).toEqual(["A"]);
  });
});

describe("settle edge cases (tie)", () => {
  it("maps a tie to a refund summary", async () => {
    const relay = createStubWalletBridge();
    localStorageTokenStore.save(stravaTokens("A", "One", 1));
    const { client: clientA, session: sessionA } = await connectClient("alice", relay);
    localStorageTokenStore.save(stravaTokens("B", "Two", 2));
    const { client: clientB, session: sessionB } = await connectClient("bob", relay);
    attestStravaMock.mockResolvedValueOnce(attestResult(3000) as never);
    await clientA.attest();
    attestStravaMock.mockResolvedValueOnce(attestResult(3000) as never);
    await clientB.attest();
    const relayOpenings = new Map<number, { who: string; value: string; rand: string }[]>();
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/wager-openings") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          wagerId: unknown;
          who: string;
          value: string;
          rand: string;
        };
        if (
          typeof body.wagerId !== "string" ||
          body.wagerId === "" ||
          (body.who !== "A" && body.who !== "B") ||
          typeof body.value !== "string" ||
          typeof body.rand !== "string" ||
          !/^0x[0-9a-f]+$/i.test(body.value) ||
          !/^0x[0-9a-f]+$/i.test(body.rand)
        ) {
          return jsonResponse(
            { error: 'body must be { wagerId, who: "A"|"B", value: 0x-hex, rand: 0x-hex }' },
            400,
          );
        }
        const list = relayOpenings.get(Number(body.wagerId)) ?? [];
        list.push({ who: body.who, value: body.value, rand: body.rand });
        relayOpenings.set(Number(body.wagerId), list);
        return jsonResponse({ stored: true });
      }
      const match = u.match(/\/wager-openings\/(\d+)$/);
      if (match) return jsonResponse({ openings: relayOpenings.get(Number(match[1])) ?? [] });
      return jsonResponse({}, 404);
    });
    const created = await clientA.createWager({
      opponent: {
        name: "o",
        handle: "o",
        role: "opponent",
        holderBinding: sessionB.athlete.holderBinding,
      },
      metricId: 1n,
      stake: 5,
      deadlineBlock: BigInt(Math.floor(Date.now() / 1000) + 90),
    });
    void sessionA;
    await clientB.acceptWager(created.id);
    await clientA.submitWorkout(created.id, (await clientA.vault())[0].id);
    await clientB.submitWorkout(created.id, (await clientB.vault())[0].id);
    const result = await clientA.settleWager(created.id);
    expect(result.wager.result?.tie).toBe(true);
    expect(result.wager.result?.winner).toBeUndefined();
    expect(result.wager.result?.summary).toContain("Tie");
  });
});

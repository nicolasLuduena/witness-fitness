// Wire-contract sanity for the demo sidecar (Phase B): exact request/response
// shapes the UI agent is wiring against, dedupe rules, wager lifecycle state
// transitions (create → accept → submit ×2 → settle), opening recording, and
// error mapping. The real gate is the live E2E; these tests pin the shapes.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pureCircuits } from "@witnessfitness/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Athlete } from "../src/demo-sidecar.js";
import {
  createDemoSidecarWithDeps,
  type DemoSidecarConfig,
  DemoVault,
  dayOfTimestamp,
  demoHolderSecret,
  loadSidecarConfig,
  metricsFromAssertion,
  type SidecarDeps,
  type StoredCredential,
  submissionRandFor,
} from "../src/demo-sidecar.js";
import type { NotarizedAttestation, StrideDerivedState } from "../src/index.js";

const config: DemoSidecarConfig = {
  ...loadSidecarConfig({}),
  port: 0,
  contractAddress: "0xdeadbeef",
  notaryUrls: ["http://127.0.0.1:1"],
  txTimeoutMs: 5_000,
  notaryTimeoutMs: 5_000,
  walletInitTimeoutMs: 5_000,
};

const holderSecret = demoHolderSecret(config.genesisSeed);
const HOLDER_BINDING = pureCircuits.holderBinding(holderSecret);
const EMPLOYER_BINDING = pureCircuits.holderBinding(
  (await import("../src/demo-sidecar.js")).demoEmployerSecret(config.genesisSeed),
);
const CANNED_VAULT_KEY = new Uint8Array([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32,
]);
const CANNED_VAULT_KEY_B = new Uint8Array([
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32, 33,
]);
const TS = 1786000000n;

const cannedAssertion = (value: bigint): NotarizedAttestation["assertion"] => ({
  version: 1n,
  provider: 1n,
  claims: [
    { metricId: 1n, value },
    { metricId: 0n, value: 0n },
    { metricId: 0n, value: 0n },
    { metricId: 0n, value: 0n },
    { metricId: 0n, value: 0n },
    { metricId: 0n, value: 0n },
    { metricId: 0n, value: 0n },
    { metricId: 0n, value: 0n },
  ],
  claimCount: 1n,
  timestamp: 1786000000n,
  nonce: new Uint8Array(32).fill(7),
  reclaimProofHash: new Uint8Array(32).fill(9),
});

// Athlete B's fixture carries a different distance so the wager has a winner.
const cannedAttestation = (identifier: string): NotarizedAttestation => ({
  assertion: cannedAssertion(identifier.includes("B") ? 54321n : 12345n),
  signatures: [
    { announcement: { x: 1n, y: 2n }, response: 3n },
    { announcement: { x: 4n, y: 5n }, response: 6n },
    { announcement: { x: 0n, y: 1n }, response: 0n },
  ],
  notaryIds: ["notary-1", "notary-2"],
  metricSource: "fixture-demo",
  identifier,
});

type FakeWager = {
  challenger: bigint;
  opponent: bigint;
  metricId: bigint;
  stake: bigint;
  deadlineBlock: bigint;
  accepted: boolean;
  challengerSubmission: { is_some: boolean; value: bigint };
  opponentSubmission: { is_some: boolean; value: bigint };
  settled: boolean;
  challengerCoinKey: Uint8Array;
  opponentCoinKey: Uint8Array;
};

const fakeState = (
  holderBinding: bigint,
  opts: {
    vault?: [Uint8Array, { holderBinding: bigint; timestamp: bigint }][];
    streak?: { count: bigint; lastDay: bigint } | null;
    badges?: bigint[];
    wagers?: Map<bigint, FakeWager>;
    nextWagerId?: bigint;
    balances?: Map<bigint, bigint>;
  },
): StrideDerivedState =>
  ({
    vault: opts.vault ?? [],
    nextWagerId: opts.nextWagerId ?? 0n,
    wagers: {
      isEmpty: () => (opts.wagers ?? new Map()).size === 0,
      size: () => BigInt((opts.wagers ?? new Map()).size),
      member: (k: bigint) => (opts.wagers ?? new Map()).has(k),
      lookup: (k: bigint) => (opts.wagers ?? new Map()).get(k) as FakeWager,
      [Symbol.iterator]: () => (opts.wagers ?? new Map())[Symbol.iterator](),
    },
    balances: {
      isEmpty: () => (opts.balances ?? new Map()).size === 0,
      size: () => BigInt((opts.balances ?? new Map()).size),
      member: (k: bigint) => (opts.balances ?? new Map()).has(k),
      lookup: (k: bigint) => (opts.balances ?? new Map()).get(k) ?? 0n,
      [Symbol.iterator]: () => (opts.balances ?? new Map())[Symbol.iterator](),
    },
    payoutKeys: {
      isEmpty: () => true,
      size: () => 0n,
      member: () => false,
      lookup: () => ({ bytes: new Uint8Array(32) }),
      [Symbol.iterator]: () => [][Symbol.iterator](),
    },
    treasuryKey: { bytes: new Uint8Array(32).fill(0xe5) },
    streaks: {
      isEmpty: () => false,
      size: () => (opts.streak === null ? 0n : 1n),
      member: (k: bigint) => opts.streak !== null && k === holderBinding,
      lookup: () => opts.streak ?? { count: 0n, lastDay: 0n },
      [Symbol.iterator]: () => [][Symbol.iterator](),
    },
    badges: {
      isEmpty: () => (opts.badges ?? []).length === 0,
      size: () => BigInt(opts.badges?.length ?? 0),
      member: (k: bigint) => k === holderBinding && (opts.badges ?? []).length > 0,
      lookup: () => ({
        isEmpty: () => (opts.badges ?? []).length === 0,
        size: () => BigInt(opts.badges?.length ?? 0),
        member: (b: bigint) => (opts.badges ?? []).includes(b),
        [Symbol.iterator]: () => (opts.badges ?? [])[Symbol.iterator](),
      }),
      [Symbol.iterator]: () => [][Symbol.iterator](),
    },
  }) as unknown as StrideDerivedState;

const HOLDER_BINDING_B = pureCircuits.holderBinding(demoHolderSecret(config.genesisSeedB));

const coinKeyOf = (fill: number): { bytes: Uint8Array } => ({
  bytes: new Uint8Array(32).fill(fill),
});

const makeDeps = (
  holderBinding: bigint,
  calls: {
    advanceStreak: number;
    mintBadge: number;
    proveBadge: number;
    createWager: number;
    acceptWager: number;
    submitWorkout: number;
    settleWager: number;
    deposit: number;
    withdraw: number;
  },
): SidecarDeps & { staged: { athlete: Athlete; fields: Record<string, unknown> }[] } => {
  const ledger = {
    wagers: new Map<bigint, FakeWager>(),
    nextWagerId: 0n,
  };
  const identities: SidecarDeps["identities"] = {
    A: { holderBinding, coinKey: coinKeyOf(1) },
    B: { holderBinding: HOLDER_BINDING_B, coinKey: coinKeyOf(3) },
  };
  const staged: { athlete: Athlete; fields: Record<string, unknown> }[] = [];
  return {
    notary: {
      attestate: async (artifacts: unknown) => {
        const id = (artifacts as { identifier?: string })?.identifier ?? "fixture-id";
        return cannedAttestation(id);
      },
    },
    flows: {
      attest: async (athlete) => ({
        vaultKey: athlete === "A" ? CANNED_VAULT_KEY : CANNED_VAULT_KEY_B,
        tx: { public: { txHash: "0xattest-tx" } },
      }),
      createWager: async (athlete, input) => {
        calls.createWager += 1;
        const id = ledger.nextWagerId;
        ledger.nextWagerId += 1n;
        ledger.wagers.set(id, {
          challenger: identities[athlete].holderBinding,
          opponent: input.opponentBinding,
          metricId: input.metricId,
          stake: input.stake,
          deadlineBlock: input.deadlineBlock,
          accepted: false,
          challengerSubmission: { is_some: false, value: 0n },
          opponentSubmission: { is_some: false, value: 0n },
          settled: false,
          challengerCoinKey: input.coinKey.bytes,
          opponentCoinKey: new Uint8Array(32),
        });
        return { public: { txHash: "0xcreate-tx" } };
      },
      acceptWager: async (athlete, id, coinKey) => {
        calls.acceptWager += 1;
        const wager = ledger.wagers.get(id);
        if (!wager) throw new Error("no such wager");
        wager.accepted = true;
        wager.opponentCoinKey = coinKey.bytes;
        return { public: { txHash: "0xaccept-tx" } };
      },
      submitWorkout: async (athlete, id) => {
        calls.submitWorkout += 1;
        const wager = ledger.wagers.get(id);
        if (!wager) throw new Error("no such wager");
        const sub = { is_some: true, value: athlete === "A" ? 12345n : 54321n };
        if (athlete === "A") {
          wager.challengerSubmission = sub;
        } else {
          wager.opponentSubmission = sub;
        }
        return { public: { txHash: "0xsubmit-tx" } };
      },
      settleWager: async (_athlete, id) => {
        calls.settleWager += 1;
        const wager = ledger.wagers.get(id);
        if (wager) {
          wager.settled = true;
        }
        return { public: { txHash: "0xsettle-tx" } };
      },
      advanceStreak: async () => {
        calls.advanceStreak += 1;
        return { public: { txHash: "0xstreak-tx" } };
      },
      mintBadge: async () => {
        calls.mintBadge += 1;
        return { public: { txHash: "0xbadge-tx" } };
      },
      proveBadge: async () => {
        calls.proveBadge += 1;
        return { public: { txHash: "0xprove-tx" } };
      },
      deposit: async () => {
        calls.deposit += 1;
        return { public: { txHash: "0xdeposit-tx" } };
      },
      withdraw: async () => {
        calls.withdraw += 1;
        return { public: { txHash: "0xwithdraw-tx" } };
      },
    },
    stagePrivateState: async (athlete, fields) => {
      staged.push({ athlete, fields: { ...fields } });
    },
    readState: async () =>
      fakeState(holderBinding, {
        vault: [[CANNED_VAULT_KEY, { holderBinding, timestamp: TS }]],
        streak: { count: 1n, lastDay: 20671n },
        badges: [2n],
        wagers: ledger.wagers,
        nextWagerId: ledger.nextWagerId,
      }),
    shieldedBalances: async () => (calls.settleWager > 0 ? { [NFT_TYPE]: 1n } : {}),
    identities,
    holderSecret,
    holderBinding,
    verifierBinding: EMPLOYER_BINDING,
    config,
    staged,
  };
};

const NFT_TYPE = "0x" + "ab".repeat(32);
const stakeOf = (night: number): string => "0x" + (BigInt(night) * 10n ** 12n).toString(16);
const futureDeadline = (): string =>
  "0x" + (BigInt(Math.floor(Date.now() / 1000)) + 3_600n).toString(16);
const pastDeadline = (): string =>
  "0x" + (BigInt(Math.floor(Date.now() / 1000)) - 3_600n).toString(16);

describe("demo sidecar wire contract", () => {
  let sidecar: ReturnType<typeof createDemoSidecarWithDeps>;
  let baseUrl: string;
  const calls = {
    advanceStreak: 0,
    mintBadge: 0,
    proveBadge: 0,
    createWager: 0,
    acceptWager: 0,
    submitWorkout: 0,
    settleWager: 0,
    deposit: 0,
    withdraw: 0,
  };

  beforeAll(async () => {
    sidecar = createDemoSidecarWithDeps(config, makeDeps(HOLDER_BINDING, calls));
    await sidecar.init();
    await new Promise<void>((resolve) => sidecar.server.listen(0, resolve));
    const { port } = sidecar.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await sidecar.close();
  });

  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // Wager-lifecycle tests get a FRESH sidecar each (the shared one carries
  // vault/wager state from earlier tests).
  const freshSidecar = async () => {
    const deps = makeDeps(HOLDER_BINDING, {
      advanceStreak: 0,
      mintBadge: 0,
      proveBadge: 0,
      createWager: 0,
      acceptWager: 0,
      submitWorkout: 0,
      settleWager: 0,
      deposit: 0,
      withdraw: 0,
    });
    const side = createDemoSidecarWithDeps(config, deps);
    await side.init();
    await new Promise<void>((resolve) => side.server.listen(0, resolve));
    const { port } = side.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}`;
    const postTo = (path: string, body: unknown): Promise<Response> =>
      fetch(`${url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    return { side, deps, url, postTo, close: () => side.close() };
  };

  it("OPTIONS preflight with an allowed origin → 204 + CORS headers", async () => {
    const res = await fetch(`${baseUrl}/attest`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("GET /health with an allowed Origin → CORS header present", async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { origin: "http://127.0.0.1:4173" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4173");
  });

  it("GET /health with a disallowed origin → no CORS header", async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { origin: "http://evil.example" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("GET /health reports ok/ready/contractAddress/network + stateless flags", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.ready).toBe(true);
    expect(body.contractAddress).toBe("0xdeadbeef");
    expect(body.network).toBe("devnet");
    expect(body.stateless).toBe(true);
    expect(typeof body.hasStrava).toBe("boolean");
    expect(typeof body.hasAttestorKey).toBe("boolean");
  });

  it("POST /attest returns { vaultKey, txHash, timestamp, metrics } (hex wire)", async () => {
    const res = await post("/attest", { artifacts: { identifier: "fixture-1" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.vaultKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.txHash).toBe("0xattest-tx");
    expect(body.timestamp).toBe("0x" + TS.toString(16));
    expect(body.metrics).toEqual([{ metricId: "0x1", label: "distance", value: "0x3039" }]);
  });

  it("POST /attest with the same artifacts → 409 double-count (never hangs)", async () => {
    const res = await post("/attest", { artifacts: { identifier: "fixture-1" } });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/double-count/);
  });

  it("POST /attest with a missing artifacts field → 400", async () => {
    const res = await post("/attest", {});
    expect(res.status).toBe(400);
  });

  it("POST /streak/advance on the attested vaultKey returns { streakCount, lastDay }", async () => {
    const res = await post("/streak/advance", { vaultKey: vaultKeyOfFirst() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ streakCount: "0x1", lastDay: "0x50bf" });
    expect(calls.advanceStreak).toBe(1);
  });

  it("POST /streak/advance on an unknown vaultKey → 404", async () => {
    const res = await post("/streak/advance", { vaultKey: "0x" + "ab".repeat(32) });
    expect(res.status).toBe(404);
    expect(((await res.json()) as Record<string, unknown>).error).toMatch(/attest first/);
  });

  it("POST /badge/mint { vaultKey, badgeId } returns { badgeId, minted }", async () => {
    const res = await post("/badge/mint", { vaultKey: vaultKeyOfFirst(), badgeId: "0x2" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ badgeId: "0x2", minted: true });
    expect(calls.mintBadge).toBe(1);
  });

  it("POST /badge/mint with an unknown badgeId → 400", async () => {
    const res = await post("/badge/mint", { vaultKey: vaultKeyOfFirst(), badgeId: "0x5" });
    expect(res.status).toBe(400);
  });

  it("POST /badge/prove { badgeId } returns { badgeId, verified, verifierBinding }", async () => {
    const res = await post("/badge/prove", { badgeId: "0x2" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      badgeId: "0x2",
      verified: true,
      verifierBinding: "0x" + EMPLOYER_BINDING.toString(16),
    });
    expect(calls.proveBadge).toBe(1);
  });

  it("POST /badge/prove for an unbidden badge → 404", async () => {
    const res = await post("/badge/prove", { badgeId: "0x9" });
    expect(res.status).toBe(404);
  });

  it("POST /points/deposit { athlete, amount } returns { athlete, amount, points, txHash }", async () => {
    const res = await post("/points/deposit", { athlete: "A", amount: "0x3e8" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      athlete: "A",
      amount: "0x3e8",
      points: "0x0",
      txHash: "0xdeposit-tx",
    });
    expect(calls.deposit).toBe(1);
  });

  it("POST /points/deposit with a missing/zero amount → 400", async () => {
    const missing = await post("/points/deposit", { athlete: "A" });
    expect(missing.status).toBe(400);
    const zero = await post("/points/deposit", { athlete: "A", amount: "0x0" });
    expect(zero.status).toBe(400);
  });

  it("POST /points/withdraw { athlete, amount } (admin-initiated) returns points remaining", async () => {
    const res = await post("/points/withdraw", { athlete: "A", amount: "0x64" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      athlete: "A",
      amount: "0x64",
      points: "0x0",
      txHash: "0xwithdraw-tx",
    });
    expect(calls.withdraw).toBe(1);
  });

  it("POST /points/withdraw with a malformed amount → 400", async () => {
    const res = await post("/points/withdraw", { athlete: "A", amount: "100" });
    expect(res.status).toBe(400);
  });

  it("GET /state lists vault/streaks/badges/points for the demo identity", async () => {
    const res = await fetch(`${baseUrl}/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.points).toBe("0x0");
    expect(body.vault).toHaveLength(1);
    expect(body.vault[0]).toHaveProperty("vaultKey");
    expect(body.streaks).toEqual({ count: "0x1", lastDay: "0x50bf" });
    expect(body.badges).toEqual(["0x2"]);
  });

  it("serves 503 until init completes", async () => {
    const cold = createDemoSidecarWithDeps(
      config,
      makeDeps(HOLDER_BINDING, {
        advanceStreak: 0,
        mintBadge: 0,
        proveBadge: 0,
        createWager: 0,
        acceptWager: 0,
        submitWorkout: 0,
        settleWager: 0,
        deposit: 0,
        withdraw: 0,
      }),
    );
    await new Promise<void>((resolve) => cold.server.listen(0, resolve));
    const { port } = cold.server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifacts: {} }),
    });
    expect(res.status).toBe(503);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(((await health.json()) as Record<string, unknown>).ready).toBe(false);
    await cold.close();
  });

  describe("wager lifecycle (two identities)", () => {
    it("create → accept → submit both → settle (winner B, NFT detected)", async () => {
      const { postTo, close } = await freshSidecar();
      try {
        const resA = await postTo("/attest", { artifacts: { identifier: "fixture-A" } });
        expect(resA.status).toBe(200);
        expect(((await resA.json()) as Record<string, unknown>).athlete).toBe("A");

        const resB = await postTo("/attest", {
          athlete: "B",
          artifacts: { identifier: "fixture-B" },
        });
        expect(resB.status).toBe(200);
        expect(((await resB.json()) as Record<string, unknown>).athlete).toBe("B");

        const created = await postTo("/wager/create", {
          athlete: "A",
          opponent: "B",
          metricId: "0x1",
          stake: stakeOf(10),
          deadlineBlock: pastDeadline(),
        });
        expect(created.status).toBe(200);
        expect(await created.json()).toEqual({
          wagerId: "0x0",
          txHash: "0xcreate-tx",
          challenger: "A",
          opponent: "B",
          metricId: "0x1",
          stake: stakeOf(10),
          deadlineBlock: pastDeadline(),
        });

        const accepted = await postTo("/wager/accept", { athlete: "B", id: "0x0" });
        expect(accepted.status).toBe(200);
        expect(await accepted.json()).toEqual({
          id: "0x0",
          athlete: "B",
          accepted: true,
          txHash: "0xaccept-tx",
        });

        const subA = await postTo("/wager/submit", { athlete: "A", id: "0x0" });
        expect(subA.status).toBe(200);
        expect(((await subA.json()) as Record<string, unknown>).submitted).toBe(true);

        const subB = await postTo("/wager/submit", { athlete: "B", id: "0x0" });
        expect(subB.status).toBe(200);
        expect(((await subB.json()) as Record<string, unknown>).submitted).toBe(true);

        const settled = await postTo("/wager/settle", { id: "0x0" });
        expect(settled.status).toBe(200);
        const settleBody = (await settled.json()) as Record<string, unknown>;
        expect(settleBody.winner).toBe("B");
        expect(settleBody.potNIGHT).toBe(stakeOf(20));
        expect(settleBody.nft).toEqual({ tokenType: NFT_TYPE, txHash: "0xsettle-tx" });
        expect(settleBody.disclosed).toEqual({ A: "0x3039", B: "0xd431" });
      } finally {
        await close();
      }
    });
    it("stages deterministic submission rands and challenger-first openings", async () => {
      const { postTo, deps, close } = await freshSidecar();
      try {
        await postTo("/attest", { artifacts: { identifier: "fixture-A" } });
        await postTo("/attest", { athlete: "B", artifacts: { identifier: "fixture-B" } });
        await postTo("/wager/create", {
          athlete: "A",
          opponent: "B",
          metricId: "0x1",
          stake: stakeOf(10),
          deadlineBlock: pastDeadline(),
        });
        await postTo("/wager/accept", { athlete: "B", id: "0x0" });
        await postTo("/wager/submit", { athlete: "A", id: "0x0" });
        await postTo("/wager/submit", { athlete: "B", id: "0x0" });

        const submissionStages = deps.staged.filter((s) => s.fields.submissionRand !== undefined);
        expect(submissionStages).toHaveLength(2);
        const randA = submissionStages.find((s) => s.athlete === "A")!.fields.submissionRand;
        const randB = submissionStages.find((s) => s.athlete === "B")!.fields.submissionRand;
        expect(randA).toEqual(submissionRandFor(0n, "A"));
        expect(randB).toEqual(submissionRandFor(0n, "B"));
        expect(randA).not.toEqual(randB);

        await postTo("/wager/settle", { id: "0x0" });
        const openingsStage = deps.staged.find((s) => s.fields.wagerOpenings !== undefined)!;
        // Challenger (A) first: [A.value, A.rand, B.value, B.rand] — contract law.
        expect(openingsStage.fields.wagerOpenings).toEqual([
          12345n,
          submissionRandFor(0n, "A"),
          54321n,
          submissionRandFor(0n, "B"),
        ]);
      } finally {
        await close();
      }
    });
    it("settles a both-gave-up wager as a refund (winner null, no NFT)", async () => {
      const { postTo, deps, close } = await freshSidecar();
      try {
        await postTo("/wager/create", {
          athlete: "A",
          opponent: "B",
          metricId: "0x1",
          stake: stakeOf(10),
          deadlineBlock: pastDeadline(),
        });
        await postTo("/wager/accept", { athlete: "B", id: "0x0" });
        // neither side submits — settle must refund both (winner null)
        const settled = await postTo("/wager/settle", { id: "0x0" });
        expect(settled.status).toBe(200);
        const body = (await settled.json()) as Record<string, unknown>;
        expect(body.winner).toBeNull();
        expect(body.nft).toBeNull();
        expect(body.disclosed).toEqual({ A: null, B: null });
        const openingsStage = deps.staged.find((s) => s.fields.wagerOpenings !== undefined);
        // the refund branch ignores openings — zeros staged
        expect(openingsStage?.fields.wagerOpenings).toEqual([
          0n,
          new Uint8Array(32),
          0n,
          new Uint8Array(32),
        ]);
      } finally {
        await close();
      }
    });

    it("settles a one-sided wager as a forfeit to the submitter", async () => {
      const { postTo, close } = await freshSidecar();
      try {
        await postTo("/wager/create", {
          athlete: "A",
          opponent: "B",
          metricId: "0x1",
          stake: stakeOf(10),
          deadlineBlock: pastDeadline(),
        });
        await postTo("/wager/accept", { athlete: "B", id: "0x0" });
        await postTo("/attest", { artifacts: { identifier: "fixture-A" } });
        await postTo("/wager/submit", { athlete: "A", id: "0x0" });
        const settled = await postTo("/wager/settle", { id: "0x0" });
        expect(settled.status).toBe(200);
        const body = (await settled.json()) as Record<string, unknown>;
        expect(body.winner).toBe("A");
        expect(body.nft).not.toBeNull();
        expect(body.disclosed).toEqual({ A: expect.any(String), B: null });
      } finally {
        await close();
      }
    });
    it("rejects double submission (409) and missing credentials (404)", async () => {
      const { postTo, close } = await freshSidecar();
      try {
        await postTo("/wager/create", {
          athlete: "A",
          opponent: "B",
          metricId: "0x1",
          stake: stakeOf(10),
          deadlineBlock: pastDeadline(),
        });
        await postTo("/wager/accept", { athlete: "B", id: "0x0" });
        await postTo("/attest", { artifacts: { identifier: "fixture-A" } });
        const first = await postTo("/wager/submit", { athlete: "A", id: "0x0" });
        expect(first.status).toBe(200);
        const second = await postTo("/wager/submit", { athlete: "A", id: "0x0" });
        expect(second.status).toBe(409);
        expect(((await second.json()) as Record<string, unknown>).error).toMatch(
          /already submitted/,
        );

        // B has no credential yet → 404 before any tx.
        const noCred = await postTo("/wager/submit", { athlete: "B", id: "0x0" });
        expect(noCred.status).toBe(404);
        expect(((await noCred.json()) as Record<string, unknown>).error).toMatch(/attest first/);
      } finally {
        await close();
      }
    });
    it("settle requires both submissions and a reached deadline", async () => {
      const { postTo, close } = await freshSidecar();
      try {
        await postTo("/wager/create", {
          athlete: "A",
          opponent: "B",
          metricId: "0x1",
          stake: stakeOf(10),
          deadlineBlock: futureDeadline(),
        });
        const early = await postTo("/wager/settle", { id: "0x0" });
        expect(early.status).toBe(400);
        expect(((await early.json()) as Record<string, unknown>).error).toMatch(
          /deadline not reached/,
        );

        await postTo("/wager/accept", { athlete: "B", id: "0x0" });
        await postTo("/attest", { artifacts: { identifier: "fixture-A" } });
        await postTo("/attest", { athlete: "B", artifacts: { identifier: "fixture-B" } });
        await postTo("/wager/submit", { athlete: "A", id: "0x0" });
        await postTo("/wager/submit", { athlete: "B", id: "0x0" });
        const notYet = await postTo("/wager/settle", { id: "0x0" });
        expect(notYet.status).toBe(400);
        expect(((await notYet.json()) as Record<string, unknown>).error).toMatch(
          /deadline not reached/,
        );
      } finally {
        await close();
      }
    });
    it("rejects unknown wagers and wrong acceptors", async () => {
      const { postTo, close } = await freshSidecar();
      try {
        const unknown = await postTo("/wager/accept", { athlete: "B", id: "0x7" });
        expect(unknown.status).toBe(404);

        await postTo("/wager/create", {
          athlete: "A",
          opponent: "B",
          metricId: "0x1",
          stake: stakeOf(10),
          deadlineBlock: pastDeadline(),
        });
        const wrongAcceptor = await postTo("/wager/accept", { athlete: "A", id: "0x0" });
        expect(wrongAcceptor.status).toBe(400);
        expect(((await wrongAcceptor.json()) as Record<string, unknown>).error).toMatch(
          /only the opponent/,
        );

        const selfOpponent = await postTo("/wager/create", {
          athlete: "A",
          opponent: "A",
          metricId: "0x1",
          stake: stakeOf(10),
          deadlineBlock: pastDeadline(),
        });
        expect(selfOpponent.status).toBe(400);
      } finally {
        await close();
      }
    });
    it("GET /wagers lists status with sealed submissions and the derived winner", async () => {
      const { postTo, url, close } = await freshSidecar();
      try {
        await postTo("/wager/create", {
          athlete: "A",
          opponent: "B",
          metricId: "0x1",
          stake: stakeOf(10),
          deadlineBlock: pastDeadline(),
        });
        await postTo("/wager/accept", { athlete: "B", id: "0x0" });
        await postTo("/attest", { artifacts: { identifier: "fixture-A" } });
        await postTo("/attest", { athlete: "B", artifacts: { identifier: "fixture-B" } });
        await postTo("/wager/submit", { athlete: "A", id: "0x0" });
        await postTo("/wager/submit", { athlete: "B", id: "0x0" });
        await postTo("/wager/settle", { id: "0x0" });

        const res = await fetch(`${url}/wagers`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { wagers: Record<string, unknown>[] };
        expect(body.wagers).toHaveLength(1);
        expect(body.wagers[0]).toMatchObject({
          id: "0x0",
          challenger: "A",
          opponent: "B",
          metricId: "0x1",
          stake: stakeOf(10),
          accepted: true,
          settled: true,
          challengerSubmitted: true,
          opponentSubmitted: true,
          winner: "B",
        });
      } finally {
        await close();
      }
    });
    it("GET /state?athlete=B filters by identity B binding", async () => {
      const { url, close } = await freshSidecar();
      try {
        const res = await fetch(`${url}/state?athlete=B`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.athlete).toBe("B");
        expect(body.vault).toEqual([]);
        const resA = await fetch(`${url}/state`);
        expect(resA.status).toBe(200);
        expect(((await resA.json()) as Record<string, unknown>).athlete).toBe("A");
      } finally {
        await close();
      }
    });
  });
});

function vaultKeyOfFirst(): string {
  return "0x" + Buffer.from(CANNED_VAULT_KEY).toString("hex");
}

describe("sidecar pure helpers", () => {
  it("metricsFromAssertion respects claimCount and labels distance", () => {
    const metrics = metricsFromAssertion(cannedAssertion(12345n));
    expect(metrics).toEqual([{ metricId: 1n, label: "distance", value: 12345n }]);
  });

  it("dayOfTimestamp floors to the UTC day", () => {
    expect(dayOfTimestamp(1786000000n)).toBe(20671n);
    expect(dayOfTimestamp(86399n)).toBe(0n);
    expect(dayOfTimestamp(86400n)).toBe(1n);
  });

  it("DemoVault dedupes identifiers and vault keys", () => {
    const vault = new DemoVault();
    expect(vault.addIdentifier("id-1")).toBe(true);
    expect(vault.addIdentifier("id-1")).toBe(false);
    const credential = {
      vaultKey: new Uint8Array(32).fill(1),
      attestation: cannedAttestation("id-1"),
      commitRand: new Uint8Array(32),
      timestamp: 1786000000n,
      metrics: [],
      txHash: "0x1",
    } as StoredCredential;
    vault.put(credential);
    expect(vault.get("0x" + "01".repeat(32))).toBe(credential);
    expect(() => vault.put(credential)).toThrow(/double-count/);
    expect(vault.list()).toHaveLength(1);
  });
});

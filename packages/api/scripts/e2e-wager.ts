// LIVE WAGER E2E (Phase B gate — REAL unshielded NIGHT + shielded NFT):
// fixture 3545 m → athlete A; fixture 2426 m → athlete B; A creates a wager
// (stake 10 NIGHT, deadline ≈ now + 90s), B accepts, both submit, wait for
// deadline + 60s grace, settle. Asserts: winner A, A's unshielded NIGHT up
// ~20, NFT minted to A's shielded key (token detected by the sidecar + the
// script's own wallet check).
//   pnpm --filter @witnessfitness/api run e2e:wager
// Requires: devnet up, notaries on 8101-8103, sidecar on :8200 (ready).
import { readFileSync } from "node:fs";
import { buildWallet } from "@witnessfitness/contract/wallet";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";

const SIDECAR = process.env.SIDECAR_URL ?? "http://127.0.0.1:8200";
const NIGHT = 10n ** 12n;
const STAKE = 10n * NIGHT;
const SEED_A = "0000000000000000000000000000000000000000000000000000000000000001";
const SEED_B = "0000000000000000000000000000000000000000000000000000000000000002";

const post = async (
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await fetch(`${SIDECAR}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const get = async (path: string): Promise<Record<string, unknown>> => {
  const res = await fetch(`${SIDECAR}${path}`);
  return (await res.json()) as Record<string, unknown>;
};

const hexOf = (v: bigint): string => "0x" + v.toString(16);

const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../client/fixtures/${name}`, import.meta.url), "utf-8"));

const nightBalance = async (seed: string): Promise<bigint> => {
  const ctx = await buildWallet(
    {
      indexer: process.env.INDEXER_URL ?? "http://127.0.0.1:8088/api/v3/graphql",
      indexerWS: process.env.INDEXER_WS_URL ?? "ws://127.0.0.1:8088/api/v3/graphql/ws",
      node: process.env.NODE_URL ?? "http://127.0.0.1:9944",
      proofServer: process.env.PROOF_SERVER_URL ?? "http://127.0.0.1:6300",
    },
    seed,
  );
  const state = await new Promise((resolve) => ctx.wallet.state().subscribe(resolve));
  const balance = state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n;
  await ctx.wallet.terminate?.().catch(() => undefined);
  return balance;
};

const expectStatus = (
  label: string,
  result: { status: number; body: Record<string, unknown> },
  expected: number,
): void => {
  if (result.status !== expected) {
    throw new Error(
      `${label}: expected HTTP ${expected}, got ${result.status}: ${JSON.stringify(result.body)}`,
    );
  }
  console.log(`  ${label}: HTTP ${result.status}`, JSON.stringify(result.body).slice(0, 240));
};

const main = async () => {
  const health = await get("/health");
  console.log("[e2e] sidecar health:", JSON.stringify(health));
  if (health.ready !== true) {
    throw new Error("sidecar not ready");
  }

  console.log("[e2e] baseline unshielded NIGHT balances...");
  const beforeA = await nightBalance(SEED_A);
  const beforeB = await nightBalance(SEED_B);
  console.log(`  A: ${beforeA} (${Number(beforeA) / 1e12} NIGHT)`);
  console.log(`  B: ${beforeB} (${Number(beforeB) / 1e12} NIGHT)`);

  console.log("[e2e] attest A (3545 m fixture)...");
  const attA = await post("/attest", {
    athlete: "A",
    artifacts: loadFixture("fixture-activity-19643821429-3545m.json"),
  });
  expectStatus("attest A", attA, 200);
  const vaultKeyA = attA.body.vaultKey as string;

  console.log("[e2e] attest B (2426 m fixture)...");
  const attB = await post("/attest", {
    athlete: "B",
    artifacts: loadFixture("fixture-activity-19643822226-2426m.json"),
  });
  expectStatus("attest B", attB, 200);
  const vaultKeyB = attB.body.vaultKey as string;

  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 90n;
  console.log(
    `[e2e] create wager (A challenger, stake 10 NIGHT, deadline now+90s = ${deadline})...`,
  );
  const created = await post("/wager/create", {
    athlete: "A",
    opponent: "B",
    metricId: "0x1",
    stake: hexOf(STAKE),
    deadlineBlock: hexOf(deadline),
  });
  expectStatus("create wager", created, 200);
  const wagerId = created.body.wagerId as string;

  console.log("[e2e] accept wager (B)...");
  const accepted = await post("/wager/accept", { athlete: "B", id: wagerId });
  expectStatus("accept wager", accepted, 200);

  console.log("[e2e] submit A (3545)...");
  const subA = await post("/wager/submit", { athlete: "A", id: wagerId });
  expectStatus("submit A", subA, 200);

  console.log("[e2e] submit B (2426)...");
  const subB = await post("/wager/submit", { athlete: "B", id: wagerId });
  expectStatus("submit B", subB, 200);

  const settleAt = deadline + 60n + 10n;
  const waitSecs = Number(settleAt - BigInt(Math.floor(Date.now() / 1000)));
  console.log(`[e2e] waiting ${Math.max(waitSecs, 0)}s for deadline + 60s grace...`);
  while (BigInt(Math.floor(Date.now() / 1000)) < settleAt) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  console.log("[e2e] settle...");
  const settled = await post("/wager/settle", { id: wagerId });
  expectStatus("settle wager", settled, 200);
  const settleBody = settled.body;
  console.log("[e2e] SETTLE RESULT:", JSON.stringify(settleBody, null, 2));

  if (settleBody.winner !== "A") {
    throw new Error(`expected winner A, got ${String(settleBody.winner)}`);
  }
  if (settleBody.potNIGHT !== hexOf(2n * STAKE)) {
    throw new Error(`expected potNIGHT ${hexOf(2n * STAKE)}, got ${String(settleBody.potNIGHT)}`);
  }
  const nft = settleBody.nft as { tokenType?: string } | null;
  if (nft === null || typeof nft.tokenType !== "string") {
    throw new Error(`expected a winner NFT, got ${JSON.stringify(nft)}`);
  }

  console.log("[e2e] post-settle unshielded NIGHT balances...");
  const afterA = await nightBalance(SEED_A);
  const afterB = await nightBalance(SEED_B);
  const deltaA = afterA - beforeA;
  const deltaB = afterB - beforeB;
  console.log(`  A: ${beforeA} → ${afterA} (delta ${deltaA} = ${Number(deltaA) / 1e12} NIGHT)`);
  console.log(`  B: ${beforeB} → ${afterB} (delta ${deltaB} = ${Number(deltaB) / 1e12} NIGHT)`);
  if (deltaA < 9n * NIGHT || deltaA > 11n * NIGHT) {
    throw new Error(`A NIGHT delta ${deltaA} outside [9, 11] NIGHT — pot did not arrive`);
  }
  if (deltaB < -11n * NIGHT || deltaB > -9n * NIGHT) {
    throw new Error(`B NIGHT delta ${deltaB} outside [-11, -9] NIGHT — stake not escrowed`);
  }

  console.log("[e2e] GET /wagers + /state?athlete=A...");
  const wagers = await get("/wagers");
  console.log("  wagers:", JSON.stringify(wagers));
  const stateA = await get("/state?athlete=A");
  console.log("  state A:", JSON.stringify(stateA).slice(0, 400));

  console.log("[e2e] ✅ WAGER E2E PASSED — winner A, pot paid, NFT", nft.tokenType.slice(0, 24));
};

// The built wallets hold open node/indexer WebSocket connections — without an
// explicit exit the process hangs after PASSED.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[e2e] FAILED:", error);
    process.exitCode = 1;
  });

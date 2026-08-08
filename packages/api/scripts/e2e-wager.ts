// LIVE WAGER E2E (Phase A v3 gate — SHIELDED points + treasury):
// fixture 3545 m → athlete A; fixture 2426 m → athlete B. Both athletes
// DEPOSIT shielded NIGHT (stake + 2% fee) through /points/deposit; A creates
// a wager (stake 10 NIGHT, deadline ≈ now + 90s), B accepts, both submit,
// wait for deadline + 60s grace, settle. Asserts: winner A, A's points up
// 2 * stake, B's points drained, NFT minted to A's shielded key.
//   pnpm --filter @witnessfitness/api run e2e:wager
// Requires: devnet up (athlete + admin wallets funded with SHIELDED NIGHT —
// the shielded-funding bootstrap, see devnet/README.md), notaries on
// 8101-8103, sidecar on :8200 (ready).
import { readFileSync } from "node:fs";

const SIDECAR = process.env.SIDECAR_URL ?? "http://127.0.0.1:8200";
const NIGHT = 10n ** 12n;
const STAKE = 10n * NIGHT;
const FEE = STAKE / 50n; // 2% platform fee (entryFee in stride.compact)

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

const pointsOf = async (athlete: "A" | "B"): Promise<bigint> => {
  const state = await get(`/state?athlete=${athlete}`);
  const raw = (state.points ?? "0x0") as string;
  return BigInt(raw);
};

const main = async () => {
  const health = await get("/health");
  console.log("[e2e] sidecar health:", JSON.stringify(health));
  if (health.ready !== true) {
    throw new Error("sidecar not ready");
  }

  const beforeA = await pointsOf("A");
  const beforeB = await pointsOf("B");
  console.log(`[e2e] baseline points — A: ${beforeA}, B: ${beforeB}`);

  console.log("[e2e] attest A (3545 m fixture)...");
  const attA = await post("/attest", {
    athlete: "A",
    artifacts: loadFixture("fixture-activity-19643821429-3545m.json"),
  });
  expectStatus("attest A", attA, 200);

  console.log("[e2e] attest B (2426 m fixture)...");
  const attB = await post("/attest", {
    athlete: "B",
    artifacts: loadFixture("fixture-activity-19643822226-2426m.json"),
  });
  expectStatus("attest B", attB, 200);

  // Shielded on-ramp: both sides deposit stake + 2% fee worth of points; the
  // NIGHT passes through to the admin treasury in the same transactions.
  console.log(`[e2e] deposit A (${STAKE + FEE} = stake + 2% fee)...`);
  const depA = await post("/points/deposit", {
    athlete: "A",
    amount: hexOf(STAKE + FEE),
  });
  expectStatus("deposit A", depA, 200);
  console.log(`[e2e] deposit B (${STAKE + FEE} = stake + 2% fee)...`);
  const depB = await post("/points/deposit", {
    athlete: "B",
    amount: hexOf(STAKE + FEE),
  });
  expectStatus("deposit B", depB, 200);

  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 90n;
  console.log(
    `[e2e] create wager (A challenger, stake 10 NIGHT points, deadline now+90s = ${deadline})...`,
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
    throw new Error(`expected pot ${hexOf(2n * STAKE)}, got ${String(settleBody.potNIGHT)}`);
  }
  const nft = settleBody.nft as { tokenType?: string } | null;
  if (nft === null || typeof nft.tokenType !== "string") {
    throw new Error(`expected a winner NFT, got ${JSON.stringify(nft)}`);
  }

  // Points assertions: A staked STAKE + fee then won the 2 * STAKE pot; B's
  // entry was spent. Unshielded NIGHT must NOT have moved (points-only pot).
  const afterA = await pointsOf("A");
  const afterB = await pointsOf("B");
  console.log(`[e2e] post-settle points — A: ${afterA}, B: ${afterB}`);
  if (afterA - beforeA !== 2n * STAKE) {
    throw new Error(`A points delta ${afterA - beforeA} != 2 * stake ${2n * STAKE}`);
  }
  if (afterB - beforeB !== 0n) {
    throw new Error(`B points delta ${afterB - beforeB} != 0 (entry spent)`);
  }

  console.log("[e2e] GET /wagers + /state?athlete=A...");
  const wagers = await get("/wagers");
  console.log("  wagers:", JSON.stringify(wagers));
  const stateA = await get("/state?athlete=A");
  console.log("  state A:", JSON.stringify(stateA).slice(0, 400));

  console.log("[e2e] ✅ WAGER E2E PASSED — winner A, pot in points, NFT", nft.tokenType.slice(0, 24));
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[e2e] FAILED:", error);
    process.exitCode = 1;
  });

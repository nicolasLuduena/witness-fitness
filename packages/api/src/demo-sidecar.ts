// Demo sidecar (Phase B): Node service bridging the browser demo (no wallet
// extension) to the Midnight devnet. TWO demo athlete identities (genesis
// seeds ONE and TWO) with REAL unshielded NIGHT wager pots and a shielded
// winner NFT. Wager endpoints (stable contract for the UI agent):
//   POST /wager/create {athlete, opponent, metricId, stake, deadlineBlock}
//   POST /wager/accept {athlete, id}
//   POST /wager/submit {athlete, id}
//   POST /wager/settle {id, athlete?}
//   GET  /wagers
// Existing endpoints unchanged: /health, /attest (optional athlete param),
// /streak/advance, /badge/mint, /badge/prove, /state (optional athlete param).
// All bigint/bytes fields are 0x-hex strings on the wire.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { firstValueFrom } from "rxjs";
import { createAuthRequest } from "@reclaimprotocol/attestor-core";
import { configureProviders } from "@witnessfitness/contract/providers";
import {
  buildWallet,
  registerForDustGeneration,
  type WalletContext,
} from "@witnessfitness/contract/wallet";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { encodeCoinPublicKey } from "@midnight-ntwrk/ledger-v8";
import { pureCircuits, type A_Assertion, type PrivateState } from "@witnessfitness/contract";
import { metricLabel } from "@witnessfitness/notary";
import {
  NotaryClient,
  StrideContract,
  toHex,
  advanceStreakFlow,
  attestWorkout,
  createWagerFlow,
  acceptWagerFlow,
  mintBadgeFlow,
  proveBadgeFlow,
  userAddressBytes,
  type NotarizedAttestation,
  type StrideDerivedState,
  type StrideProviders,
  type WagerPayoutRouting,
  type WorkoutContext,
} from "./index.js";

export type Athlete = "A" | "B";

export interface DemoSidecarConfig {
  port: number;
  network: string;
  contractAddress: string;
  notaryUrls: string[];
  nodeUrl: string;
  indexerUrl: string;
  indexerWsUrl: string;
  proofServerUrl: string;
  genesisSeed: string;
  genesisSeedB: string;
  txTimeoutMs: number;
  notaryTimeoutMs: number;
  walletInitTimeoutMs: number;
  privateStateStore: string;
  privateStateId: string;
  privateStateStoreB: string;
  privateStateIdB: string;
  stakeNight: bigint;
  wagerDeadlineSeconds: number;
  // Stateless surface config (Round 1A): attestor auth relay + strava token
  // relay + wager-openings relay. Secrets come from env with file fallbacks
  // (attestor/.env PRIVATE_KEY, packages/client/.env STRAVA_*).
  attestorUrl: string;
  attestorPrivateKey: string;
  attestorUserId: string;
  attestorHostWhitelist: string[];
  stravaClientId: string;
  stravaClientSecret: string;
  openingsTtlMs: number;
}

const DEPLOY_OUTPUT_URL = new URL("../../contract/deploy-output.json", import.meta.url);
const ATTESTOR_ENV_URL = new URL("../../../attestor/.env", import.meta.url);
const CLIENT_ENV_URL = new URL("../../client/.env", import.meta.url);

// Read a KEY=VALUE line from an env-style file (key names only in logs —
// never the values).
const envFileValue = (fileUrl: URL, key: string): string => {
  try {
    const content = readFileSync(fileUrl, "utf-8");
    const line = content.split("\n").find((l) => l.startsWith(`${key}=`));
    return line === undefined ? "" : line.slice(key.length + 1).trim();
  } catch {
    return "";
  }
};

export const loadSidecarConfig = (env: NodeJS.ProcessEnv = process.env): DemoSidecarConfig => {
  let contractAddress = env.CONTRACT_ADDRESS ?? "";
  if (!contractAddress) {
    try {
      const output = JSON.parse(readFileSync(DEPLOY_OUTPUT_URL, "utf-8")) as {
        contractAddress?: string;
      };
      contractAddress = output.contractAddress ?? "";
    } catch {
      contractAddress = "";
    }
  }
  return {
    port: Number(env.DEMO_SIDECAR_PORT ?? 8200),
    network: env.NETWORK ?? "devnet",
    contractAddress,
    notaryUrls: (
      env.NOTARY_URLS ?? "http://127.0.0.1:8101,http://127.0.0.1:8102,http://127.0.0.1:8103"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    nodeUrl: env.NODE_URL ?? "http://127.0.0.1:9944",
    indexerUrl: env.INDEXER_URL ?? "http://127.0.0.1:8088/api/v3/graphql",
    indexerWsUrl: env.INDEXER_WS_URL ?? "ws://127.0.0.1:8088/api/v3/graphql/ws",
    proofServerUrl: env.PROOF_SERVER_URL ?? "http://127.0.0.1:6300",
    genesisSeed:
      env.GENESIS_MINT_WALLET_SEED ??
      "0000000000000000000000000000000000000000000000000000000000000001",
    genesisSeedB:
      env.GENESIS_MINT_WALLET_SEED_B ??
      "0000000000000000000000000000000000000000000000000000000000000002",
    txTimeoutMs: Number(env.DEMO_SIDECAR_TX_TIMEOUT_MS ?? 180_000),
    notaryTimeoutMs: Number(env.DEMO_SIDECAR_NOTARY_TIMEOUT_MS ?? 30_000),
    walletInitTimeoutMs: Number(env.DEMO_SIDECAR_WALLET_INIT_TIMEOUT_MS ?? 240_000),
    privateStateStore: env.DEMO_SIDECAR_PRIVATE_STATE_STORE ?? "stride",
    privateStateId: env.DEMO_SIDECAR_PRIVATE_STATE_ID ?? "wf-demo-athlete",
    privateStateStoreB: env.DEMO_SIDECAR_PRIVATE_STATE_STORE_B ?? "stride-b",
    privateStateIdB: env.DEMO_SIDECAR_PRIVATE_STATE_ID_B ?? "wf-demo-athlete-b",
    stakeNight: BigInt(env.DEMO_WAGER_STAKE_NIGHT ?? 10) * 10n ** 12n,
    wagerDeadlineSeconds: Number(env.DEMO_WAGER_DEADLINE_SECONDS ?? 90),
    attestorUrl: env.ATTESTOR_URL ?? "ws://localhost:8001/ws",
    attestorPrivateKey:
      (env.ATTESTOR_PRIVATE_KEY ?? "").trim() || envFileValue(ATTESTOR_ENV_URL, "PRIVATE_KEY"),
    attestorUserId: env.ATTESTOR_USER_ID ?? "witnessfitness-demo",
    attestorHostWhitelist: (env.ATTESTOR_HOST_WHITELIST ?? "www.strava.com")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    stravaClientId:
      (env.STRAVA_CLIENT_ID ?? "").trim() || envFileValue(CLIENT_ENV_URL, "STRAVA_CLIENT_ID"),
    stravaClientSecret:
      (env.STRAVA_CLIENT_SECRET ?? "").trim() ||
      envFileValue(CLIENT_ENV_URL, "STRAVA_CLIENT_SECRET"),
    openingsTtlMs: Number(env.DEMO_SIDECAR_OPENINGS_TTL_MS ?? 30 * 60_000),
  };
};

const sha256Of = (value: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(value, "utf-8").digest());

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf-8").digest("hex");

export const demoHolderSecret = (genesisSeed: string): Uint8Array =>
  sha256Of(`witnessfitness:demo:holder:${genesisSeed}`);

export const demoAdminSecret = (genesisSeed: string): Uint8Array =>
  sha256Of(`witnessfitness:demo:admin:${genesisSeed}`);

export const demoEmployerSecret = (genesisSeed: string): Uint8Array =>
  sha256Of(`witnessfitness:demo:employer:${genesisSeed}`);

export interface Metric {
  metricId: bigint;
  label: string;
  value: bigint;
}

export const metricsFromAssertion = (assertion: A_Assertion): Metric[] =>
  assertion.claims.slice(0, Number(assertion.claimCount)).map((claim) => ({
    metricId: claim.metricId,
    label: metricLabel(claim.metricId),
    value: claim.value,
  }));

export const dayOfTimestamp = (timestamp: bigint): bigint => timestamp / 86400n;

// Deterministic per (wager, athlete) — Bytes<32> since the sealed submission
// commitment is persistentCommit (audit L1).
export const submissionRandFor = (wagerId: bigint, athlete: Athlete): Uint8Array => {
  const hex = sha256Hex(`witnessfitness:wager-submission:${wagerId}:${athlete}`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

export interface StoredCredential {
  vaultKey: Uint8Array;
  attestation: NotarizedAttestation;
  commitRand: Uint8Array;
  timestamp: bigint;
  metrics: Metric[];
  txHash: string;
  athlete: Athlete;
}

export class DemoVault {
  private readonly credentials = new Map<string, StoredCredential>();
  private readonly identifiers = new Set<string>();

  addIdentifier(identifier: string): boolean {
    if (this.identifiers.has(identifier)) {
      return false;
    }
    this.identifiers.add(identifier);
    return true;
  }

  put(credential: StoredCredential): void {
    const key = toHex(credential.vaultKey);
    if (this.credentials.has(key)) {
      throw new Error("credential already stored (double-count)");
    }
    this.credentials.set(key, credential);
  }

  get(vaultKeyHex: string): StoredCredential | undefined {
    return this.credentials.get(vaultKeyHex);
  }

  // Latest credential for an athlete (insertion order = attest order).
  getLatestFor(athlete: Athlete): StoredCredential | undefined {
    const entries = [...this.credentials.values()].filter((c) => c.athlete === athlete);
    return entries.length > 0 ? entries[entries.length - 1] : undefined;
  }

  list(): StoredCredential[] {
    return [...this.credentials.values()];
  }
}

export interface WagerSubmissionRecord {
  value: bigint;
  // Bytes<32> — the sealed submission commitment is persistentCommit
  // (audit L1).
  rand: Uint8Array;
}

export interface WagerRecord {
  id: bigint;
  challenger: Athlete;
  opponent: Athlete;
  metricId: bigint;
  stake: bigint;
  deadlineBlock: bigint;
  submissions: Partial<Record<Athlete, WagerSubmissionRecord>>;
}

export class WagerRegistry {
  private readonly records = new Map<string, WagerRecord>();

  put(record: WagerRecord): void {
    this.records.set(record.id.toString(16), record);
  }

  get(id: bigint): WagerRecord | undefined {
    return this.records.get(id.toString(16));
  }

  has(id: bigint): boolean {
    return this.records.has(id.toString(16));
  }

  list(): WagerRecord[] {
    return [...this.records.values()];
  }
}

// Serializes all chain interactions — the flows share private states per
// athlete, so concurrent requests must not race on them.
class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

const withTimeout = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms),
    ),
  ]);

const hexOf = (value: bigint): string => "0x" + value.toString(16);

const txHashOf = (tx: unknown): string => {
  const publicData = (tx as { public?: { txHash?: unknown } } | undefined)?.public;
  return publicData && typeof publicData.txHash === "string" ? publicData.txHash : "";
};

// Deps seam: production wires the real wallets + contract flows; tests inject
// fakes to pin the wire contract.
export interface SidecarDeps {
  notary: Pick<NotaryClient, "attestate">;
  flows: {
    attest(
      athlete: Athlete,
      attestation: NotarizedAttestation,
      commitRand: Uint8Array,
    ): Promise<{ vaultKey: Uint8Array; tx: unknown }>;
    createWager(
      athlete: Athlete,
      input: {
        opponentBinding: bigint;
        metricId: bigint;
        stake: bigint;
        deadlineBlock: bigint;
        payout: Uint8Array;
        coinKey: { bytes: Uint8Array };
      },
    ): Promise<unknown>;
    acceptWager(athlete: Athlete, id: bigint, routing: WagerPayoutRouting): Promise<unknown>;
    submitWorkout(
      athlete: Athlete,
      wagerId: bigint,
      vaultKey: Uint8Array,
      value: bigint,
    ): Promise<unknown>;
    settleWager(athlete: Athlete, id: bigint): Promise<unknown>;
    advanceStreak(
      attestation: NotarizedAttestation,
      commitRand: Uint8Array,
      vaultKey: Uint8Array,
      day: bigint,
    ): Promise<unknown>;
    mintBadge(
      attestation: NotarizedAttestation,
      commitRand: Uint8Array,
      badgeId: bigint,
      vaultKey: Uint8Array,
    ): Promise<unknown>;
    proveBadge(badgeId: bigint, verifierBinding: bigint): Promise<unknown>;
  };
  stagePrivateState(athlete: Athlete, fields: Partial<PrivateState>): Promise<void>;
  readState(): Promise<StrideDerivedState>;
  shieldedBalances(athlete: Athlete): Promise<Record<string, bigint>>;
  identities: Record<Athlete, { holderBinding: bigint; routing: WagerPayoutRouting }>;
  holderSecret: Uint8Array;
  holderBinding: bigint;
  verifierBinding: bigint;
  config: DemoSidecarConfig;
}

export interface DemoSidecar {
  readonly server: ReturnType<typeof createServer>;
  readonly config: DemoSidecarConfig;
  readonly vault: DemoVault;
  readonly holderBinding: bigint;
  readonly verifierBinding: bigint;
  init(): Promise<void>;
  isReady(): boolean;
  readyError(): string | null;
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage, maxBytes = 10_000_000): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });

const jsonSafe = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return "0x" + value.toString(16);
  }
  if (value instanceof Uint8Array) {
    return "0x" + Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]),
    );
  }
  return value;
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(jsonSafe(body)));
};

// CORS for the demo UI origins (vite dev :5173, vite preview :4173).
// Matching origins get CORS headers on EVERY response; non-matching origins
// are served without them (the browser blocks — correct for a demo sidecar).
const CORS_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

const corsOriginFor = (req: IncomingMessage): string | null => {
  const origin = req.headers.origin;
  return typeof origin === "string" && CORS_ALLOWED_ORIGINS.includes(origin) ? origin : null;
};

const applyCors = (res: ServerResponse, origin: string): void => {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Vary", "Origin");
};

const toVaultJson = (credential: StoredCredential): Record<string, unknown> => ({
  vaultKey: toHex(credential.vaultKey),
  timestamp: hexOf(credential.timestamp),
  metrics: credential.metrics.map((m) => ({
    metricId: hexOf(m.metricId),
    label: m.label,
    value: hexOf(m.value),
  })),
  txHash: credential.txHash,
  athlete: credential.athlete,
});

export const createDemoSidecar = (config: DemoSidecarConfig): DemoSidecar =>
  createDemoSidecarWithDeps(config, null);

// Internal factory: production path builds real deps lazily inside init();
// tests pass fakes directly.
export const createDemoSidecarWithDeps = (
  config: DemoSidecarConfig,
  testDeps: SidecarDeps | null,
): DemoSidecar => {
  const vault = new DemoVault();
  const wagers = new WagerRegistry();
  const queue = new SerialQueue();
  const holderSecret = demoHolderSecret(config.genesisSeed);
  const holderSecretB = demoHolderSecret(config.genesisSeedB);
  const adminSecret = demoAdminSecret(config.genesisSeed);
  const adminSecretB = demoAdminSecret(config.genesisSeedB);
  const holderBinding = pureCircuits.holderBinding(holderSecret);
  const holderBindingB = pureCircuits.holderBinding(holderSecretB);
  const employerSecret = demoEmployerSecret(config.genesisSeed);
  const verifierBinding = pureCircuits.holderBinding(employerSecret);

  let deps: SidecarDeps | null = testDeps;
  let ready = false;
  let error: string | null = null;
  let walletA: WalletContext | null = null;
  let walletB: WalletContext | null = null;
  let providersA: StrideProviders | null = null;

  const athleteSecret = (athlete: Athlete): Uint8Array =>
    athlete === "A" ? holderSecret : holderSecretB;

  const requireReady = (): SidecarDeps => {
    if (deps === null) {
      throw new Error("sidecar not initialized");
    }
    return deps;
  };

  const parseAthlete = (raw: unknown, fallback: Athlete): Athlete => {
    if (raw === "A" || raw === "B") {
      return raw;
    }
    if (raw === undefined || raw === null) {
      return fallback;
    }
    throw new Error('athlete must be "A" or "B"');
  };

  const buildIdentity = async (
    walletCtx: WalletContext,
  ): Promise<{
    payout: Uint8Array;
    coinKey: { bytes: Uint8Array };
    unshieldedAddress: string;
    nightBalance: bigint;
  }> => {
    const state = await firstValueFrom(walletCtx.wallet.state());
    const nightBalance = state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n;
    const bech32m = UnshieldedAddress.codec.encode(getNetworkId(), state.unshielded.address);
    const hex = UnshieldedAddress.codec.decode(getNetworkId(), bech32m).hexString;
    const payout = userAddressBytes(hex);
    const coinKey = { bytes: encodeCoinPublicKey(walletCtx.shieldedSecretKeys.coinPublicKey) };
    return { payout, coinKey, unshieldedAddress: bech32m.toString(), nightBalance };
  };

  const init = async (): Promise<void> => {
    if (testDeps !== null) {
      ready = true;
      return;
    }
    try {
      await withTimeout(
        (async () => {
          walletA = await buildWallet(
            {
              indexer: config.indexerUrl,
              indexerWS: config.indexerWsUrl,
              node: config.nodeUrl,
              proofServer: config.proofServerUrl,
            },
            config.genesisSeed,
          );
          await registerForDustGeneration(walletA.wallet, walletA.unshieldedKeystore);
          providersA = await configureProviders(
            walletA,
            {
              indexer: config.indexerUrl,
              indexerWS: config.indexerWsUrl,
              proofServer: config.proofServerUrl,
            },
            config.privateStateStore,
          );
          const contractA = await StrideContract.join(
            providersA,
            config.contractAddress,
            config.privateStateId,
            StrideContract.freshPrivateState(adminSecret, holderSecret),
          );
          const ctxA: WorkoutContext = {
            contract: contractA,
            privateStateId: config.privateStateId,
            holderSecret,
          };

          walletB = await buildWallet(
            {
              indexer: config.indexerUrl,
              indexerWS: config.indexerWsUrl,
              node: config.nodeUrl,
              proofServer: config.proofServerUrl,
            },
            config.genesisSeedB,
          );
          await registerForDustGeneration(walletB.wallet, walletB.unshieldedKeystore);
          const providersB = await configureProviders(
            walletB,
            {
              indexer: config.indexerUrl,
              indexerWS: config.indexerWsUrl,
              proofServer: config.proofServerUrl,
            },
            config.privateStateStoreB,
          );
          const contractB = await StrideContract.join(
            providersB,
            config.contractAddress,
            config.privateStateIdB,
            StrideContract.freshPrivateState(adminSecretB, holderSecretB),
          );
          const ctxB: WorkoutContext = {
            contract: contractB,
            privateStateId: config.privateStateIdB,
            holderSecret: holderSecretB,
          };

          const identityA = await buildIdentity(walletA);
          const identityB = await buildIdentity(walletB);
          console.log(
            `[sidecar] athlete A binding 0x${holderBinding.toString(16).slice(0, 16)}… NIGHT ${identityA.nightBalance} addr ${identityA.unshieldedAddress}`,
          );
          console.log(
            `[sidecar] athlete B binding 0x${holderBindingB.toString(16).slice(0, 16)}… NIGHT ${identityB.nightBalance} addr ${identityB.unshieldedAddress}`,
          );

          const ctxFor = (athlete: Athlete): WorkoutContext => (athlete === "A" ? ctxA : ctxB);
          const providersFor = (athlete: Athlete): StrideProviders =>
            athlete === "A" ? providersA! : providersB;

          deps = {
            notary: new NotaryClient(config.notaryUrls),
            flows: {
              attest: (athlete, attestation, commitRand) =>
                attestWorkout(ctxFor(athlete), attestation, commitRand),
              createWager: (athlete, input) => createWagerFlow(ctxFor(athlete), input),
              acceptWager: (athlete, id, routing) => acceptWagerFlow(ctxFor(athlete), id, routing),
              submitWorkout: (athlete, wagerId, vaultKey, value) =>
                ctxFor(athlete).contract.submitWorkout(wagerId, vaultKey, value),
              settleWager: (athlete, id) => ctxFor(athlete).contract.settleWager(id),
              advanceStreak: (attestation, commitRand, vaultKey, day) =>
                advanceStreakFlow(ctxA, attestation, commitRand, vaultKey, day),
              mintBadge: (attestation, commitRand, badgeId, vaultKey) =>
                mintBadgeFlow(ctxA, attestation, commitRand, badgeId, vaultKey),
              proveBadge: (badgeId, binding) => proveBadgeFlow(ctxA, badgeId, binding),
            },
            stagePrivateState: async (athlete, fields) => {
              const providers = providersFor(athlete);
              const ctx = ctxFor(athlete);
              providers.privateStateProvider.setContractAddress(config.contractAddress);
              const existing = await providers.privateStateProvider.get(ctx.privateStateId);
              const base: PrivateState =
                existing ??
                StrideContract.freshPrivateState(new Uint8Array(32), athleteSecret(athlete));
              await providers.privateStateProvider.set(ctx.privateStateId, { ...base, ...fields });
            },
            readState: () => contractA.readState(),
            shieldedBalances: async (athlete) => {
              const wallet = athlete === "A" ? walletA! : walletB!;
              const state = await firstValueFrom(wallet.wallet.state());
              return state.shielded.balances as Record<string, bigint>;
            },
            identities: {
              A: {
                holderBinding,
                routing: { payout: identityA.payout, coinKey: identityA.coinKey },
              },
              B: {
                holderBinding: holderBindingB,
                routing: { payout: identityB.payout, coinKey: identityB.coinKey },
              },
            },
            holderSecret,
            holderBinding,
            verifierBinding,
            config,
          };
        })(),
        config.walletInitTimeoutMs,
        "wallet init + contract join",
      );
      ready = true;
      error = null;
      console.log(
        `[sidecar] ready — contract ${config.contractAddress} | bindings A 0x${holderBinding
          .toString(16)
          .slice(0, 16)}… B 0x${holderBindingB.toString(16).slice(0, 16)}…`,
      );
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      console.error("[sidecar] init failed:", error);
      throw caught;
    }
  };

  const handleAttest = async (body: unknown): Promise<{ status: number; json: unknown }> => {
    const artifacts = (body as { artifacts?: unknown } | null)?.artifacts;
    const athlete = parseAthlete((body as { athlete?: unknown } | null)?.athlete, "A");
    if (artifacts === undefined) {
      return {
        status: 400,
        json: { error: "body must be { artifacts: ProofArtifacts, athlete? }" },
      };
    }
    const { notary, flows } = requireReady();
    const attestation = await withTimeout(
      notary.attestate(artifacts),
      config.notaryTimeoutMs,
      "notary fan-out",
    );
    if (!vault.addIdentifier(attestation.identifier)) {
      return {
        status: 409,
        json: { error: "proof artifacts already attested (double-count)" },
      };
    }
    const commitRand = randomBytes(32);
    const { vaultKey, tx } = await withTimeout(
      flows.attest(athlete, attestation, commitRand),
      config.txTimeoutMs,
      "verifyAttestation",
    );
    const vaultKeyHex = toHex(vaultKey);
    if (vault.get(vaultKeyHex) !== undefined) {
      return { status: 409, json: { error: "credential already attested (double-count)" } };
    }
    const credential: StoredCredential = {
      vaultKey,
      attestation,
      commitRand,
      timestamp: attestation.assertion.timestamp,
      metrics: metricsFromAssertion(attestation.assertion),
      txHash: txHashOf(tx),
      athlete,
    };
    vault.put(credential);
    return { status: 200, json: toVaultJson(credential) };
  };

  const handleStreakAdvance = async (body: unknown): Promise<{ status: number; json: unknown }> => {
    const vaultKeyHex = (body as { vaultKey?: unknown } | null)?.vaultKey;
    if (typeof vaultKeyHex !== "string") {
      return { status: 400, json: { error: "body must be { vaultKey }" } };
    }
    const credential = vault.get(vaultKeyHex);
    if (credential === undefined) {
      return { status: 404, json: { error: "unknown credential — attest first" } };
    }
    const { flows, readState } = requireReady();
    const day = dayOfTimestamp(credential.attestation.assertion.timestamp);
    await withTimeout(
      flows.advanceStreak(credential.attestation, credential.commitRand, credential.vaultKey, day),
      config.txTimeoutMs,
      "advanceStreak",
    );
    const state = await withTimeout(readState(), config.txTimeoutMs, "readState");
    const streak = state.streaks.member(holderBinding)
      ? state.streaks.lookup(holderBinding)
      : { count: 0n, lastDay: 0n };
    return {
      status: 200,
      json: { streakCount: hexOf(streak.count), lastDay: hexOf(streak.lastDay) },
    };
  };

  const handleBadgeMint = async (body: unknown): Promise<{ status: number; json: unknown }> => {
    const vaultKeyHex = (body as { vaultKey?: unknown } | null)?.vaultKey;
    const rawBadgeId = (body as { badgeId?: unknown } | null)?.badgeId;
    if (typeof vaultKeyHex !== "string" || typeof rawBadgeId !== "string") {
      return { status: 400, json: { error: "body must be { vaultKey, badgeId }" } };
    }
    const badgeId = BigInt(rawBadgeId);
    if (badgeId !== 1n && badgeId !== 2n) {
      return {
        status: 400,
        json: { error: "badgeId must be 1 (streak>=3) or 2 (distance>=10000)" },
      };
    }
    const credential = vault.get(vaultKeyHex);
    if (credential === undefined) {
      return { status: 404, json: { error: "unknown credential — attest first" } };
    }
    const { flows, readState } = requireReady();
    await withTimeout(
      flows.mintBadge(credential.attestation, credential.commitRand, badgeId, credential.vaultKey),
      config.txTimeoutMs,
      "mintBadge",
    );
    const state = await withTimeout(readState(), config.txTimeoutMs, "readState");
    const minted =
      state.badges.member(holderBinding) && state.badges.lookup(holderBinding).member(badgeId);
    return { status: 200, json: { badgeId: hexOf(badgeId), minted } };
  };

  const handleBadgeProve = async (body: unknown): Promise<{ status: number; json: unknown }> => {
    const rawBadgeId = (body as { badgeId?: unknown } | null)?.badgeId;
    if (typeof rawBadgeId !== "string") {
      return { status: 400, json: { error: "body must be { badgeId }" } };
    }
    const badgeId = BigInt(rawBadgeId);
    const { flows, readState } = requireReady();
    const state = await withTimeout(readState(), config.txTimeoutMs, "readState");
    if (
      !state.badges.member(holderBinding) ||
      !state.badges.lookup(holderBinding).member(badgeId)
    ) {
      return { status: 404, json: { error: "not a badge holder" } };
    }
    await withTimeout(flows.proveBadge(badgeId, verifierBinding), config.txTimeoutMs, "proveBadge");
    return {
      status: 200,
      json: { badgeId: hexOf(badgeId), verified: true, verifierBinding: hexOf(verifierBinding) },
    };
  };

  const handleWagerCreate = async (body: unknown): Promise<{ status: number; json: unknown }> => {
    const athlete = parseAthlete((body as { athlete?: unknown } | null)?.athlete, "A");
    const rawOpponent = (body as { opponent?: unknown } | null)?.opponent;
    const rawMetricId = (body as { metricId?: unknown } | null)?.metricId;
    const rawStake = (body as { stake?: unknown } | null)?.stake;
    const rawDeadline = (body as { deadlineBlock?: unknown } | null)?.deadlineBlock;
    if (
      (rawOpponent !== "A" && rawOpponent !== "B") ||
      typeof rawMetricId !== "string" ||
      typeof rawStake !== "string" ||
      typeof rawDeadline !== "string"
    ) {
      return {
        status: 400,
        json: { error: "body must be { athlete?, opponent, metricId, stake, deadlineBlock }" },
      };
    }
    const opponent = rawOpponent as Athlete;
    if (opponent === athlete) {
      return { status: 400, json: { error: "opponent must differ from athlete" } };
    }
    const metricId = BigInt(rawMetricId);
    const stake = BigInt(rawStake);
    const deadlineBlock = BigInt(rawDeadline);
    if (metricId !== 1n && metricId !== 2n) {
      return { status: 400, json: { error: "metricId must be 1 (distance) or 2 (moving time)" } };
    }
    if (stake <= 0n) {
      return { status: 400, json: { error: "stake must be positive" } };
    }
    const { flows, readState, identities } = requireReady();
    const routing = identities[athlete].routing;
    const tx = await withTimeout(
      flows.createWager(athlete, {
        opponentBinding: identities[opponent].holderBinding,
        metricId,
        stake,
        deadlineBlock,
        payout: routing.payout,
        coinKey: routing.coinKey,
      }),
      config.txTimeoutMs,
      "createWager",
    );
    const state = await withTimeout(readState(), config.txTimeoutMs, "readState");
    const wagerId = state.nextWagerId - 1n;
    wagers.put({
      id: wagerId,
      challenger: athlete,
      opponent,
      metricId,
      stake,
      deadlineBlock,
      submissions: {},
    });
    return {
      status: 200,
      json: {
        wagerId: hexOf(wagerId),
        txHash: txHashOf(tx),
        challenger: athlete,
        opponent,
        metricId: hexOf(metricId),
        stake: hexOf(stake),
        deadlineBlock: hexOf(deadlineBlock),
      },
    };
  };

  const handleWagerAccept = async (body: unknown): Promise<{ status: number; json: unknown }> => {
    const athlete = parseAthlete((body as { athlete?: unknown } | null)?.athlete, "A");
    const rawId = (body as { id?: unknown } | null)?.id;
    if (typeof rawId !== "string") {
      return { status: 400, json: { error: "body must be { athlete?, id }" } };
    }
    const id = BigInt(rawId);
    const record = wagers.get(id);
    if (record === undefined) {
      return { status: 404, json: { error: "unknown wager — create it first" } };
    }
    if (athlete !== record.opponent) {
      return { status: 400, json: { error: `only the opponent (${record.opponent}) can accept` } };
    }
    const { flows, identities } = requireReady();
    const tx = await withTimeout(
      flows.acceptWager(athlete, id, identities[athlete].routing),
      config.txTimeoutMs,
      "acceptWager",
    );
    return { status: 200, json: { id: hexOf(id), athlete, accepted: true, txHash: txHashOf(tx) } };
  };

  const handleWagerSubmit = async (body: unknown): Promise<{ status: number; json: unknown }> => {
    const athlete = parseAthlete((body as { athlete?: unknown } | null)?.athlete, "A");
    const rawId = (body as { id?: unknown } | null)?.id;
    if (typeof rawId !== "string") {
      return { status: 400, json: { error: "body must be { athlete?, id }" } };
    }
    const id = BigInt(rawId);
    const record = wagers.get(id);
    if (record === undefined) {
      return { status: 404, json: { error: "unknown wager — create it first" } };
    }
    if (record.submissions[athlete] !== undefined) {
      return { status: 409, json: { error: "athlete already submitted (double-count)" } };
    }
    const credential = vault.getLatestFor(athlete);
    if (credential === undefined) {
      return {
        status: 404,
        json: { error: `no credential for athlete ${athlete} — attest first` },
      };
    }
    const metric = credential.metrics.find((m) => m.metricId === record.metricId);
    if (metric === undefined) {
      return { status: 400, json: { error: "no claim for the wager metric in the credential" } };
    }
    const { flows, readState } = requireReady();
    const state = await withTimeout(readState(), config.txTimeoutMs, "readState");
    const onChain = state.wagers.member(id) ? state.wagers.lookup(id) : null;
    if (onChain === null) {
      return { status: 404, json: { error: "wager not found on-chain" } };
    }
    if (onChain.settled) {
      return { status: 409, json: { error: "wager settled" } };
    }
    if (!onChain.accepted) {
      return { status: 400, json: { error: "wager not accepted" } };
    }
    const rand = submissionRandFor(id, athlete);
    await withTimeout(
      requireReady().stagePrivateState(athlete, {
        assertion: credential.attestation.assertion,
        signatures: credential.attestation.signatures,
        commitRand: credential.commitRand,
        holderSecret: athleteSecret(athlete),
        submissionRand: rand,
      }),
      config.txTimeoutMs,
      "stage submission",
    );
    const tx = await withTimeout(
      flows.submitWorkout(athlete, id, credential.vaultKey, metric.value),
      config.txTimeoutMs,
      "submitWorkout",
    );
    record.submissions[athlete] = { value: metric.value, rand };
    return {
      status: 200,
      json: { id: hexOf(id), athlete, submitted: true, txHash: txHashOf(tx) },
    };
  };

  const handleWagerSettle = async (body: unknown): Promise<{ status: number; json: unknown }> => {
    const athlete = parseAthlete((body as { athlete?: unknown } | null)?.athlete, "A");
    const rawId = (body as { id?: unknown } | null)?.id;
    if (typeof rawId !== "string") {
      return { status: 400, json: { error: "body must be { id, athlete? }" } };
    }
    const id = BigInt(rawId);
    const record = wagers.get(id);
    if (record === undefined) {
      return { status: 404, json: { error: "unknown wager — create it first" } };
    }
    const subA = record.submissions.A;
    const subB = record.submissions.B;
    // 0 or 1 submissions are VALID settlement states: neither → refund both;
    // one → forfeit pays the single submitter (the contract decides). The
    // openings are only staged when both submissions exist.
    const bothSubmitted = subA !== undefined && subB !== undefined;
    const { flows, readState, shieldedBalances } = requireReady();
    const state = await withTimeout(readState(), config.txTimeoutMs, "readState");
    const onChain = state.wagers.member(id) ? state.wagers.lookup(id) : null;
    if (onChain === null || onChain.settled) {
      return { status: 409, json: { error: "wager already settled" } };
    }
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    if (nowSeconds < record.deadlineBlock + 60n) {
      return { status: 400, json: { error: "deadline not reached (deadline + 60s grace)" } };
    }
    // Openings order is contract law: [challengerValue, challengerRand,
    // opponentValue, opponentRand] (stride.compact settleWager). With fewer
    // than two submissions the contract ignores them — stage zeros.
    const both = [subA, subB] as const;
    const openings: [bigint, Uint8Array, bigint, Uint8Array] = bothSubmitted
      ? record.challenger === "A"
        ? [subA!.value, subA!.rand, subB!.value, subB!.rand]
        : [subB!.value, subB!.rand, subA!.value, subA!.rand]
      : [0n, new Uint8Array(32), 0n, new Uint8Array(32)];
    await withTimeout(
      requireReady().stagePrivateState(athlete, { wagerOpenings: openings }),
      config.txTimeoutMs,
      "stage openings",
    );
    const winner: "A" | "B" | "tie" | null = bothSubmitted
      ? subA!.value > subB!.value
        ? "A"
        : subB!.value > subA!.value
          ? "B"
          : "tie"
      : subA !== undefined
        ? "A"
        : subB !== undefined
          ? "B"
          : null;
    const nftWinner: Athlete | null = winner === "tie" || winner === null ? null : winner;
    const before = nftWinner === null ? null : await shieldedBalances(nftWinner);
    const tx = await withTimeout(flows.settleWager(athlete, id), config.txTimeoutMs, "settleWager");
    const txHash = txHashOf(tx);
    let nft: { tokenType: string; txHash: string } | null = null;
    if (nftWinner !== null) {
      // The winner's wallet syncs the minted NFT as a NEW shielded token
      // (value 1) — detect it by diffing the pre-settle token set.
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const after = await shieldedBalances(nftWinner);
        const fresh = Object.keys(after).filter((t) => !(t in before!) && after[t] === 1n);
        if (fresh.length > 0) {
          nft = { tokenType: fresh[0], txHash };
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
    return {
      status: 200,
      json: {
        id: hexOf(id),
        winner,
        potNIGHT: hexOf(2n * record.stake),
        nft,
        disclosed: {
          A: subA !== undefined ? hexOf(subA.value) : null,
          B: subB !== undefined ? hexOf(subB.value) : null,
        },
        txHash,
      },
    };
  };

  const handleWagers = async (): Promise<{ status: number; json: unknown }> => {
    const { readState, identities } = requireReady();
    const state = await withTimeout(readState(), config.txTimeoutMs, "readState");
    const bindingOf = (binding: bigint): Athlete | null =>
      binding === identities.A.holderBinding
        ? "A"
        : binding === identities.B.holderBinding
          ? "B"
          : null;
    const wagerList = [...state.wagers].map(([id, w]) => {
      const record = wagers.get(id);
      const subA = record?.submissions.A;
      const subB = record?.submissions.B;
      let winner: "A" | "B" | "tie" | null = null;
      if (w.settled && subA !== undefined && subB !== undefined) {
        winner = subA.value > subB.value ? "A" : subB.value > subA.value ? "B" : "tie";
      }
      return {
        id: hexOf(id),
        challenger: bindingOf(w.challenger) ?? "0x" + w.challenger.toString(16),
        opponent: bindingOf(w.opponent) ?? "0x" + w.opponent.toString(16),
        metricId: hexOf(w.metricId),
        stake: hexOf(w.stake),
        deadlineBlock: hexOf(w.deadlineBlock),
        accepted: w.accepted,
        settled: w.settled,
        challengerSubmitted: w.challengerSubmission.is_some,
        opponentSubmitted: w.opponentSubmission.is_some,
        winner,
      };
    });
    return { status: 200, json: { wagers: wagerList } };
  };

  // -------------------------------------------------------------------------
  // Stateless surface (Round 1A): per-request relays — no wallet, no identity,
  // no serial queue. Served before the ready gate.
  // -------------------------------------------------------------------------
  const openingsRelay = new Map<
    string,
    { who: string; value: string; rand: string; at: number }[]
  >();

  const pruneOpenings = (): void => {
    const cutoff = Date.now() - config.openingsTtlMs;
    for (const [wagerId, openings] of openingsRelay) {
      if (openings.every((o) => o.at < cutoff)) {
        openingsRelay.delete(wagerId);
      }
    }
  };

  const handleAttestorAuthRequest = async (): Promise<{ status: number; json: unknown }> => {
    if (config.attestorPrivateKey === "") {
      return {
        status: 500,
        json: { error: "ATTESTOR_PRIVATE_KEY not configured (env or attestor/.env)" },
      };
    }
    const authRequest = await createAuthRequest(
      { id: config.attestorUserId, hostWhitelist: config.attestorHostWhitelist },
      config.attestorPrivateKey,
    );
    return { status: 200, json: { authRequest } };
  };

  const stravaTokenRequest = async (
    grantType: "authorization_code" | "refresh_token",
    grantValue: string,
  ): Promise<{ status: number; json: unknown }> => {
    if (config.stravaClientId === "" || config.stravaClientSecret === "") {
      return {
        status: 500,
        json: {
          error:
            "STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET not configured (env or packages/client/.env)",
        },
      };
    }
    try {
      const res = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          grantType === "authorization_code"
            ? {
                client_id: config.stravaClientId,
                client_secret: config.stravaClientSecret,
                code: grantValue,
                grant_type: grantType,
              }
            : {
                client_id: config.stravaClientId,
                client_secret: config.stravaClientSecret,
                refresh_token: grantValue,
                grant_type: grantType,
              },
        ),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        return {
          status: 400,
          json: { error: `strava token request failed: ${String(body.message ?? res.status)}` },
        };
      }
      return { status: 200, json: body };
    } catch (error) {
      return {
        status: 502,
        json: {
          error: `strava unreachable: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  };

  const handleStravaExchange = async (
    body: unknown,
  ): Promise<{ status: number; json: unknown }> => {
    const code = (body as { code?: unknown } | null)?.code;
    if (typeof code !== "string" || code === "") {
      return { status: 400, json: { error: "body must be { code }" } };
    }
    return stravaTokenRequest("authorization_code", code);
  };

  const handleStravaRefresh = async (body: unknown): Promise<{ status: number; json: unknown }> => {
    const refreshToken = (body as { refresh_token?: unknown } | null)?.refresh_token;
    if (typeof refreshToken !== "string" || refreshToken === "") {
      return { status: 400, json: { error: "body must be { refresh_token }" } };
    }
    return stravaTokenRequest("refresh_token", refreshToken);
  };

  const handleOpeningsDeposit = async (
    body: unknown,
  ): Promise<{ status: number; json: unknown }> => {
    const raw = body as {
      wagerId?: unknown;
      who?: unknown;
      value?: unknown;
      rand?: unknown;
    } | null;
    if (
      typeof raw?.wagerId !== "string" ||
      raw.wagerId === "" ||
      (raw.who !== "A" && raw.who !== "B") ||
      typeof raw.value !== "string" ||
      typeof raw.rand !== "string" ||
      !/^0x[0-9a-f]+$/i.test(raw.value) ||
      !/^0x[0-9a-f]+$/i.test(raw.rand)
    ) {
      return {
        status: 400,
        json: { error: 'body must be { wagerId, who: "A"|"B", value: 0x-hex, rand: 0x-hex }' },
      };
    }
    pruneOpenings();
    const openings = openingsRelay.get(raw.wagerId) ?? [];
    openings.push({ who: raw.who, value: raw.value, rand: raw.rand, at: Date.now() });
    openingsRelay.set(raw.wagerId, openings);
    return { status: 200, json: { stored: true } };
  };

  const handleOpeningsGet = async (wagerId: string): Promise<{ status: number; json: unknown }> => {
    pruneOpenings();
    const openings = openingsRelay.get(wagerId);
    if (openings === undefined || openings.length === 0) {
      return { status: 404, json: { error: "no openings for wager (or expired)" } };
    }
    return {
      status: 200,
      json: { openings: openings.map(({ who, value, rand }) => ({ who, value, rand })) },
    };
  };

  const handleState = async (athlete: Athlete): Promise<{ status: number; json: unknown }> => {
    const { readState, identities } = requireReady();
    const state = await withTimeout(readState(), config.txTimeoutMs, "readState");
    const binding = identities[athlete].holderBinding;
    const vaultEntries = [...state.vault]
      .filter(([, entry]) => entry.holderBinding === binding)
      .map(([vaultKey]) => ({ vaultKey: toHex(vaultKey) }));
    const streakEntry = state.streaks.member(binding) ? state.streaks.lookup(binding) : null;
    const badgeEntries = state.badges.member(binding)
      ? [...state.badges.lookup(binding)].map(hexOf)
      : [];
    return {
      status: 200,
      json: {
        athlete,
        vault: vaultEntries,
        streaks:
          streakEntry === null
            ? null
            : { count: hexOf(streakEntry.count), lastDay: hexOf(streakEntry.lastDay) },
        badges: badgeEntries,
      },
    };
  };

  const server = createServer((req, res) => {
    const origin = corsOriginFor(req);
    if (origin !== null) {
      applyCors(res, origin);
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const handle = async (): Promise<void> => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          ok: true,
          ready,
          contractAddress: config.contractAddress,
          network: config.network,
          stateless: true,
          hasStrava: config.stravaClientId !== "" && config.stravaClientSecret !== "",
          hasAttestorKey: config.attestorPrivateKey !== "",
          ...(error !== null ? { error } : {}),
        });
        return;
      }
      // Stateless surface: served before the ready gate (no wallet needed).
      if (req.method === "POST" && url.pathname === "/attestor-auth-request") {
        const result = await handleAttestorAuthRequest();
        sendJson(res, result.status, result.json);
        return;
      }
      if (req.method === "POST" && url.pathname === "/strava/exchange") {
        const body = JSON.parse(await readBody(req));
        const result = await handleStravaExchange(body);
        sendJson(res, result.status, result.json);
        return;
      }
      if (req.method === "POST" && url.pathname === "/strava/refresh") {
        const body = JSON.parse(await readBody(req));
        const result = await handleStravaRefresh(body);
        sendJson(res, result.status, result.json);
        return;
      }
      if (req.method === "POST" && url.pathname === "/wager-openings") {
        const body = JSON.parse(await readBody(req));
        const result = await handleOpeningsDeposit(body);
        sendJson(res, result.status, result.json);
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/wager-openings/")) {
        const wagerId = url.pathname.slice("/wager-openings/".length);
        const result = await handleOpeningsGet(decodeURIComponent(wagerId));
        sendJson(res, result.status, result.json);
        return;
      }
      if (req.method !== "POST" && req.method !== "GET") {
        sendJson(res, 405, { error: "method not allowed" });
        return;
      }
      if (!ready) {
        sendJson(res, 503, { error: `sidecar not ready: ${error ?? "initializing"}` });
        return;
      }
      try {
        if (req.method === "POST" && url.pathname === "/attest") {
          const body = JSON.parse(await readBody(req));
          const result = await queue.run(() => handleAttest(body));
          sendJson(res, result.status, result.json);
          return;
        }
        if (req.method === "POST" && url.pathname === "/streak/advance") {
          const body = JSON.parse(await readBody(req));
          const result = await queue.run(() => handleStreakAdvance(body));
          sendJson(res, result.status, result.json);
          return;
        }
        if (req.method === "POST" && url.pathname === "/badge/mint") {
          const body = JSON.parse(await readBody(req));
          const result = await queue.run(() => handleBadgeMint(body));
          sendJson(res, result.status, result.json);
          return;
        }
        if (req.method === "POST" && url.pathname === "/badge/prove") {
          const body = JSON.parse(await readBody(req));
          const result = await queue.run(() => handleBadgeProve(body));
          sendJson(res, result.status, result.json);
          return;
        }
        if (req.method === "POST" && url.pathname === "/wager/create") {
          const body = JSON.parse(await readBody(req));
          const result = await queue.run(() => handleWagerCreate(body));
          sendJson(res, result.status, result.json);
          return;
        }
        if (req.method === "POST" && url.pathname === "/wager/accept") {
          const body = JSON.parse(await readBody(req));
          const result = await queue.run(() => handleWagerAccept(body));
          sendJson(res, result.status, result.json);
          return;
        }
        if (req.method === "POST" && url.pathname === "/wager/submit") {
          const body = JSON.parse(await readBody(req));
          const result = await queue.run(() => handleWagerSubmit(body));
          sendJson(res, result.status, result.json);
          return;
        }
        if (req.method === "POST" && url.pathname === "/wager/settle") {
          const body = JSON.parse(await readBody(req));
          const result = await queue.run(() => handleWagerSettle(body));
          sendJson(res, result.status, result.json);
          return;
        }
        if (req.method === "GET" && url.pathname === "/wagers") {
          const result = await queue.run(handleWagers);
          sendJson(res, result.status, result.json);
          return;
        }
        if (req.method === "GET" && url.pathname === "/state") {
          const athlete = parseAthlete(url.searchParams.get("athlete"), "A");
          const result = await queue.run(() => handleState(athlete));
          sendJson(res, result.status, result.json);
          return;
        }
        sendJson(res, 404, { error: "not found" });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        const status = message.includes("timed out") ? 504 : 400;
        sendJson(res, status, { error: message });
      }
    };
    handle().catch((caught) => {
      sendJson(res, 500, { error: caught instanceof Error ? caught.message : String(caught) });
    });
  });

  return {
    server,
    config,
    vault,
    holderBinding,
    verifierBinding,
    init,
    isReady: () => ready,
    readyError: () => error,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

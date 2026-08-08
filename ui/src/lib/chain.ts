// Live-mode delegation layer: the demo sidecar on :8200 (packages/api) owns
// every on-chain concern — notary signature collection (2-of-3), contract
// submit, private state, witness feeds. The browser UI performs typed fetch
// calls only; no Lace wallet, no provider stack, no WASM.
//
// Sidecar contract (stable):
//   GET  /health          → { ok, contractAddress, network }
//   POST /attest          { artifacts } → { vaultKey, txHash, timestamp, metrics }
//   POST /streak/advance  { vaultKey }  → { streakCount, lastDay }
//   POST /badge/mint      { vaultKey, badgeId } → { badgeId, minted }
//   POST /badge/prove     { badgeId }   → { badgeId, verified, verifierBinding }
//   GET  /state           → { vault: [...], streaks: [...], badges: [...] }

import { SIDECAR_TIMEOUT_MS, SIDECAR_URL } from "../config";
import { logError } from "./logger";

export class SidecarOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarOfflineError";
  }
}

export interface SidecarHealth {
  ok: boolean;
  contractAddress: string;
  network: string;
}

export interface SidecarMetric {
  metricId: number | string;
  label: string;
  value: number;
}

export interface SidecarAttestResponse {
  vaultKey: string;
  txHash: string;
  timestamp: number | string;
  metrics: SidecarMetric[];
}

export interface SidecarStreakAdvanceResponse {
  streakCount: number | string;
  lastDay: number | string;
}

export interface SidecarBadgeMintResponse {
  badgeId: number | string;
  minted: boolean;
}

export interface SidecarBadgeProveResponse {
  badgeId: number | string;
  verified: boolean;
  verifierBinding: string;
}

export interface SidecarVaultEntry {
  vaultKey?: string;
  key?: string;
  timestamp?: number | string;
  metrics?: SidecarMetric[];
  metric?: SidecarMetric;
}

export interface SidecarStreakEntry {
  streakCount?: number | string;
  count?: number | string;
  lastDay?: number | string;
}

export interface SidecarBadgeEntry {
  badgeId?: number | string;
  id?: number | string;
  minted?: boolean;
}

// Wire note (2026-08-07 live check): the sidecar's GET /state returns
// `streaks` as a single object { count, lastDay }, NOT an array as originally
// specced. We accept both shapes — see SidecarState below.
export interface SidecarState {
  vault: SidecarVaultEntry[];
  streaks: SidecarStreakEntry[] | SidecarStreakEntry;
  badges: SidecarBadgeEntry[];
}

export interface ArtifactsPayload {
  claim: unknown;
  signatureHex: string;
  attestorAddress: string;
  request?: { url: string; method: string; publicHeaders: Record<string, string> };
  responseText?: string;
  extractedParameterValues?: Record<string, string>;
}

export interface SidecarWagerEntry {
  id: number | string;
  challenger: string;
  opponent: string;
  metricId: number | string;
  stake: number | string;
  deadlineBlock: number | string;
  accepted: boolean;
  settled: boolean;
  challengerSubmitted: boolean;
  opponentSubmitted: boolean;
  winner: string | null;
}

export interface SidecarWagerCreateResponse {
  wagerId: string;
  txHash: string;
  challenger: string;
  opponent: string;
  metricId: string;
  stake: string;
  deadlineBlock: string;
}

export interface SidecarWagerSimpleResponse {
  id: string;
  athlete: string;
  accepted?: boolean;
  submitted?: boolean;
  txHash: string;
}

export interface SidecarWagerSettleResponse {
  id: string;
  // null = neither submitted → both stakes refunded
  winner: "A" | "B" | "tie" | null;
  potNIGHT: string;
  nft: { tokenType: string; txHash: string } | null;
  disclosed: { A: string | null; B: string | null };
  txHash: string;
}

export interface SidecarWagerList {
  wagers: SidecarWagerEntry[];
}

export interface SidecarHandle {
  baseUrl: string;
  contractAddress: string;
  network: string;
  attest(artifacts: ArtifactsPayload): Promise<SidecarAttestResponse>;
  state(): Promise<SidecarState>;
  advanceStreak(vaultKey: string): Promise<SidecarStreakAdvanceResponse>;
  mintBadge(vaultKey: string, badgeId: number): Promise<SidecarBadgeMintResponse>;
  proveBadge(badgeId: number): Promise<SidecarBadgeProveResponse>;
  wagers(): Promise<SidecarWagerList>;
  createWager(body: {
    athlete: string;
    opponent: string;
    metricId: string;
    stake: string;
    deadlineBlock: string;
  }): Promise<SidecarWagerCreateResponse>;
  acceptWager(body: { athlete: string; id: string }): Promise<SidecarWagerSimpleResponse>;
  submitWager(body: { athlete: string; id: string }): Promise<SidecarWagerSimpleResponse>;
  settleWager(body: { athlete: string; id: string }): Promise<SidecarWagerSettleResponse>;
}

// Domain errors arrive as 4xx with a JSON { error } body (sidecar convention:
// 400 validation/predicate, 404 unknown credential, 409 double-count). They
// must surface as plain errors, NOT as "service offline". Network failures,
// timeouts and 5xx stay SidecarOfflineError.
async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs = SIDECAR_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    logError(`chain.fetchJson(${url})`, err);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new SidecarOfflineError(
        `demo service offline (${url}) — request timed out after ${timeoutMs}ms`,
      );
    }
    throw new SidecarOfflineError(
      `demo service offline (${url}) — ${err instanceof Error ? err.message : "unreachable"}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let message = `HTTP ${res.status} from ${url}`;
    try {
      const parsed = (await res.json()) as { error?: unknown };
      if (typeof parsed?.error === "string") message = parsed.error;
    } catch (parseErr) {
      logError("chain.parseErrorBody", parseErr);
      // non-JSON error body — keep the HTTP message
    }
    if (res.status >= 500) {
      throw new SidecarOfflineError(`demo service error (${url}) — ${message}`);
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const joinSidecar = async (baseUrl = SIDECAR_URL): Promise<SidecarHandle> => {
  let health: SidecarHealth;
  try {
    health = await fetchJson<SidecarHealth>(`${baseUrl}/health`, { method: "GET" }, 3_000);
  } catch (err) {
    throw new SidecarOfflineError(
      err instanceof Error
        ? err.message
        : `demo service offline (${baseUrl}) — start the sidecar or switch to demo mode`,
    );
  }
  if (!health?.ok || !health.contractAddress) {
    throw new SidecarOfflineError(
      `sidecar unhealthy (${baseUrl}) — got ${JSON.stringify(health).slice(0, 120)}`,
    );
  }

  return {
    baseUrl,
    contractAddress: health.contractAddress,
    network: health.network,
    attest: async (artifacts: ArtifactsPayload): Promise<SidecarAttestResponse> =>
      fetchJson<SidecarAttestResponse>(`${baseUrl}/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifacts }),
      }),
    state: async (): Promise<SidecarState> =>
      fetchJson<SidecarState>(`${baseUrl}/state`, { method: "GET" }),
    advanceStreak: async (vaultKey: string): Promise<SidecarStreakAdvanceResponse> =>
      fetchJson<SidecarStreakAdvanceResponse>(`${baseUrl}/streak/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultKey }),
      }),
    mintBadge: async (vaultKey: string, badgeId: number): Promise<SidecarBadgeMintResponse> =>
      fetchJson<SidecarBadgeMintResponse>(`${baseUrl}/badge/mint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // sidecar enforces string badgeId (typeof check) — numbers get 400
        body: JSON.stringify({ vaultKey, badgeId: String(badgeId) }),
      }),
    proveBadge: async (badgeId: number): Promise<SidecarBadgeProveResponse> =>
      fetchJson<SidecarBadgeProveResponse>(`${baseUrl}/badge/prove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ badgeId: String(badgeId) }),
      }),
    wagers: async (): Promise<SidecarWagerList> =>
      fetchJson<SidecarWagerList>(`${baseUrl}/wagers`, { method: "GET" }),
    createWager: async (body) =>
      fetchJson<SidecarWagerCreateResponse>(`${baseUrl}/wager/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    acceptWager: async (body) =>
      fetchJson<SidecarWagerSimpleResponse>(`${baseUrl}/wager/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    submitWager: async (body) =>
      fetchJson<SidecarWagerSimpleResponse>(`${baseUrl}/wager/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    settleWager: async (body) =>
      fetchJson<SidecarWagerSettleResponse>(`${baseUrl}/wager/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
};

// Lenient wire parsing — the sidecar may send numbers, 0x-hex strings, or
// epoch seconds; normalize once here so screens never care.
export const toNumber = (value: number | string | bigint | undefined, fallback = 0): number => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = /^0x/i.test(value) ? Number(BigInt(value)) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const toEpochMs = (
  value: number | string | bigint | undefined,
  fallback = Date.now(),
): number => {
  const raw = toNumber(value, fallback / 1000);
  return raw < 10_000_000_000 ? raw * 1000 : raw; // seconds → ms
};

export const toBigInt = (value: number | string | bigint | undefined, fallback = 0n): bigint => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return /^0x/i.test(value) ? BigInt(value) : BigInt(value || "0");
};

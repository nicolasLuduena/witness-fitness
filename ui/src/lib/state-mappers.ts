// Shared lenient mappings from ledger-shaped state into UI domain types.
// The REAL bridge's readState returns the CONTRACT LEDGER's Map-like ADTs
// (member/lookup/iterator — see packages/contract managed stride index.d.ts),
// while the sidecar stub emits plain arrays. Every helper here must accept
// BOTH: arrays AND Map-like objects (type-guarded) — never .map/.filter a
// non-array again (audit P0-1).

import { ATHLETE_A, BADGES } from "../domain/story";
import {
  type AttestedCredential,
  type BadgeView,
  metricById,
  type StreakView,
} from "../domain/types";
import { toEpochMs, toNumber } from "./chain";
import { displayHash, hexShort } from "./format";

export interface LedgerMetricLike {
  metricId?: number | string | bigint;
  label?: string;
  value?: number | string | bigint;
}

export interface LedgerVaultEntryLike {
  vaultKey?: string;
  key?: string;
  timestamp?: number | string;
  metrics?: LedgerMetricLike[];
  metric?: LedgerMetricLike;
}

export interface LedgerStreakLike {
  streakCount?: number | string | bigint;
  count?: number | string | bigint;
  lastDay?: number | string | bigint;
}

export interface LedgerBadgeLike {
  badgeId?: number | string | bigint;
  id?: number | string | bigint;
  minted?: boolean;
}

// The contract ledger's Map-like ADT surface (stride contract index.d.ts):
// member/lookup plus [Symbol.iterator] over [key, value] pairs.
export interface LedgerMapLike<K, V> {
  member(key: K): boolean;
  lookup(key: K): V;
  [Symbol.iterator](): Iterator<[K, V]>;
}

export const isLedgerMapLike = <K, V>(value: unknown): value is LedgerMapLike<K, V> =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { member?: unknown }).member === "function" &&
  typeof (value as { lookup?: unknown }).lookup === "function";
// NOTE: deliberately does NOT require Symbol.iterator — the compiled
// badges ADT (Map<Field, Set<Uint8>>) exposes member/lookup but no outer
// iterator (codegen quirk for nested ADTs). The Map branch accesses via
// member/lookup only, so an outer iterator is never needed.

const bytesToHex = (bytes: Uint8Array): string =>
  "0x" +
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// Normalized vault entries: Map-like (ledger: key = vaultKey bytes, entry =
// {holderBinding, timestamp}) OR array (sidecar/stub: {vaultKey, timestamp,
// metrics}). Never throws on either shape.
export interface NormalizedVaultEntry {
  vaultKey: string;
  holderBinding: bigint | null;
  timestamp: bigint | undefined;
}

export const vaultEntriesOf = (
  vault:
    | LedgerVaultEntryLike[]
    | LedgerMapLike<Uint8Array, { holderBinding: bigint; timestamp: bigint }>
    | undefined,
): NormalizedVaultEntry[] => {
  if (vault === undefined || vault === null) return [];
  if (isLedgerMapLike<Uint8Array, { holderBinding: bigint; timestamp: bigint }>(vault)) {
    return Array.from(vault).map(([key, entry]) => ({
      vaultKey: bytesToHex(key),
      holderBinding: entry.holderBinding,
      timestamp: entry.timestamp,
    }));
  }
  return (vault as LedgerVaultEntryLike[]).map((entry) => ({
    vaultKey: entry.vaultKey ?? entry.key ?? "",
    holderBinding: null,
    timestamp: entry.timestamp !== undefined ? BigInt(toNumber(entry.timestamp, 0)) : undefined,
  }));
};

export const credentialFromVaultEntry = (
  vaultKey: string,
  txHash: string | undefined,
  timestamp: number | string | bigint | undefined,
  metrics: LedgerMetricLike[],
): AttestedCredential => {
  const chips = Array.from(
    new Set(
      metrics.flatMap((m) => {
        const value = toNumber(m.value, 0);
        if (value <= 0) return [];
        const id = toNumber(m.metricId, 0);
        return [metricById(BigInt(id)).provableChip(value)];
      }),
    ),
  );
  return {
    id: hexShort(vaultKey, 12, 8),
    athlete: ATHLETE_A,
    source: "fixture-replay",
    metric: metricById(BigInt(toNumber(metrics[0]?.metricId, 1))),
    value: toNumber(metrics[0]?.value, 0),
    commitment: vaultKey,
    txHash,
    timestamp: toEpochMs(timestamp),
    provableChips: chips.length > 0 ? chips : ["workout attested and sealed"],
    notarySignatures: 2,
    assertionId: hexShort(vaultKey, 6, 4),
  };
};

export const streakViewFrom = (
  entry:
    | LedgerStreakLike
    | LedgerStreakLike[]
    | LedgerMapLike<bigint, LedgerStreakLike>
    | undefined,
  chainPrefix: string,
  binding?: bigint,
): StreakView => {
  let resolved: LedgerStreakLike | undefined;
  if (isLedgerMapLike<bigint, LedgerStreakLike>(entry)) {
    resolved = binding !== undefined && entry.member(binding) ? entry.lookup(binding) : undefined;
  } else if (Array.isArray(entry)) {
    resolved = entry[0];
  } else {
    resolved = entry;
  }
  const current = toNumber(resolved?.streakCount ?? resolved?.count, 0);
  const lastDay = toNumber(resolved?.lastDay, 0);
  const today = Math.floor(Date.now() / 86_400_000);
  const sealedToday = current > 0 && lastDay === today;
  return {
    current,
    lastDay: BigInt(lastDay),
    days: [
      ...(sealedToday
        ? [{ day: lastDay, sealed: true, label: "LAST", active: true }]
        : [{ day: 0, sealed: false, label: "TODAY", active: true }]),
    ],
    chainId: displayHash(`${chainPrefix}:${lastDay}:${current}`),
  };
};

export const badgeViewsFrom = (
  stateBadges: LedgerBadgeLike[] | LedgerMapLike<bigint, Iterable<bigint>> | undefined,
  binding?: bigint,
): BadgeView[] => {
  const mintedIds = new Set<number>();
  if (isLedgerMapLike<bigint, Iterable<bigint>>(stateBadges)) {
    if (binding !== undefined && stateBadges.member(binding)) {
      for (const id of stateBadges.lookup(binding)) {
        mintedIds.add(Number(id));
      }
    }
  } else {
    for (const b of stateBadges ?? []) {
      if (b.minted) mintedIds.add(toNumber(b.badgeId ?? b.id, -1));
    }
  }
  return BADGES.map((b) => {
    const minted = mintedIds.has(b.id);
    return minted ? { ...b, minted, mintedAt: Date.now() } : { ...b, minted };
  });
};

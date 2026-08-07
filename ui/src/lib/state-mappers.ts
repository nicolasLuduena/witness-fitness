// Shared lenient mappings from ledger-shaped state (sidecar /state OR wallet
// bridge readState — both emit the same shapes) into UI domain types.
// Extracted from live-client so wallet mode renders byte-identical views.

import { ATHLETE_A, BADGES } from '../domain/story';
import { metricById, type AttestedCredential, type BadgeView, type StreakView } from '../domain/types';
import { displayHash, hexShort } from './format';
import { toEpochMs, toNumber } from './chain';

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

export const credentialFromVaultEntry = (
  vaultKey: string,
  txHash: string | undefined,
  timestamp: number | string | undefined,
  metrics: LedgerMetricLike[]
): AttestedCredential => {
  const chips =
    metrics.length > 0
      ? metrics.map((m) => {
          const id = toNumber(m.metricId, 0);
          const metric = metricById(BigInt(id));
          const value = toNumber(m.value, 0);
          return value > 0 ? metric.provableChip(value) : `attested ${m.label ?? metric.label}`;
        })
      : ['attested credential (sealed on-chain)'];
  return {
    id: hexShort(vaultKey, 12, 8),
    athlete: ATHLETE_A,
    source: 'fixture-replay',
    metric: metricById(BigInt(toNumber(metrics[0]?.metricId, 1))),
    value: toNumber(metrics[0]?.value, 0),
    commitment: vaultKey,
    txHash,
    timestamp: toEpochMs(timestamp),
    provableChips: chips,
    notarySignatures: 2,
    assertionId: hexShort(vaultKey, 6, 4),
  };
};

export const streakViewFrom = (
  entry: LedgerStreakLike | LedgerStreakLike[] | undefined,
  chainPrefix: string
): StreakView => {
  const first = Array.isArray(entry) ? entry[0] : entry;
  const current = toNumber(first?.streakCount ?? first?.count, 0);
  const lastDay = toNumber(first?.lastDay, 0);
  const today = Math.floor(Date.now() / 86_400_000);
  const sealedToday = current > 0 && lastDay === today;
  return {
    current,
    lastDay: BigInt(lastDay),
    days: [
      ...(sealedToday
        ? [{ day: lastDay, sealed: true, label: 'LAST', active: true }]
        : [{ day: 0, sealed: false, label: 'TODAY', active: true }]),
    ],
    chainId: displayHash(`${chainPrefix}:${lastDay}:${current}`),
  };
};

export const badgeViewsFrom = (stateBadges: LedgerBadgeLike[] | undefined): BadgeView[] => {
  const mintedIds = new Set(
    (stateBadges ?? [])
      .filter((b) => b.minted)
      .map((b) => toNumber(b.badgeId ?? b.id, -1))
  );
  return BADGES.map((b) => {
    const minted = mintedIds.has(b.id);
    return minted ? { ...b, minted, mintedAt: Date.now() } : { ...b, minted };
  });
};

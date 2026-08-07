// The fixture-mode demo story: deterministic, offline, and shaped exactly like
// live responses so switching modes is a flag, not a rewrite.
// Real-data numbers (Phase C): the three attested Strava walks — the wager is
// Ava's 3.90 km vs Milo's 2.43 km. The room never sees them until the athletes
// choose to disclose.

import type { Athlete, BadgeView } from './types';
import activity3900 from './fixtures/fixture-activity-19643821526-3900m.json';
import activity3545 from './fixtures/fixture-activity-19643821429-3545m.json';
import activity2426 from './fixtures/fixture-activity-19643822226-2426m.json';
import reserveFixture from './fixtures/fixture-github-zk-fetch-reserve-x-0m.json';

export const ATHLETE_A: Athlete = {
  name: 'Ava Reyes',
  handle: 'ava-runs',
  role: 'local',
  holderBinding: '0x4f8c…3a1e',
};

export const ATHLETE_B: Athlete = {
  name: 'Milo Chen',
  handle: 'milo-paces',
  role: 'opponent',
  holderBinding: '0xb27a…9c04',
};

export const EMPLOYER: Athlete = {
  name: 'Northwind Wellness',
  handle: 'employer-verifier',
  role: 'other',
  holderBinding: '0xef21…77d0',
};

export interface StoryCredential {
  athlete: Athlete;
  metricId: bigint;
  value: number; // meters or seconds
  daysAgo: number;
  source: 'live-session' | 'fixture-replay' | 'demo-story';
  notarySignatures: number;
}

// The local athlete's vault — one entry per attested Strava session (real
// values from the embedded fixtures: 3900 m / 2942 s, 3545 m, 2426 m).
export const STORY_VAULT: StoryCredential[] = [
  { athlete: ATHLETE_A, metricId: 1n, value: 3_900, daysAgo: 0, source: 'fixture-replay', notarySignatures: 2 },
  { athlete: ATHLETE_A, metricId: 2n, value: 2_942, daysAgo: 0, source: 'fixture-replay', notarySignatures: 2 },
  { athlete: ATHLETE_A, metricId: 1n, value: 3_545, daysAgo: 1, source: 'fixture-replay', notarySignatures: 2 },
  { athlete: ATHLETE_A, metricId: 1n, value: 2_426, daysAgo: 2, source: 'fixture-replay', notarySignatures: 2 },
];

// The opponent's workout for the seeded wager (demo knows it; the room must
// not). Real value from the 2426 m fixture.
export const OPPONENT_WORKOUT = { athlete: ATHLETE_B, metricId: 1n, value: 2_426 };

// The real Strava values, for simulated new attestations to cycle through.
export const REAL_WALK_DISTANCES_M = [3_900, 3_545, 2_426];

// Attestation log entries — replayed through the same pipeline as a live
// session ("identical crypto path" fallback per AGENTS.md §8).
// One-shot per fixture on-chain (deterministic nonce → replay blocked) AND
// per URL+context in the sidecar's dedupe guard — each entry must come from a
// DISTINCT attestation. Order: log-001 is the demo's live attest — the 3.54 km
// walk (FRESH on-chain); log-002 the 2.43 km walk (FRESH — the opponent's
// number); log-003 the 3.90 km showcase walk (CONSUMED 2026-08-07 Phase C E2E,
// tx 3c105361…); log-004 the github reserve (named fallback).
export const ATTESTATION_LOG = [
  {
    id: 'log-001',
    fixture: activity3545,
    host: new URL(activity3545.metadata.url).hostname,
    path: new URL(activity3545.metadata.url).pathname,
    attestedAt: activity3545.generatedAt,
    verified: true,
  },
  {
    id: 'log-002',
    fixture: activity2426,
    host: new URL(activity2426.metadata.url).hostname,
    path: new URL(activity2426.metadata.url).pathname,
    attestedAt: activity2426.generatedAt,
    verified: true,
  },
  {
    id: 'log-003',
    fixture: activity3900,
    host: new URL(activity3900.metadata.url).hostname,
    path: new URL(activity3900.metadata.url).pathname,
    attestedAt: activity3900.generatedAt,
    verified: true,
  },
  {
    id: 'log-004',
    fixture: reserveFixture,
    host: new URL(reserveFixture.metadata.url).hostname,
    path: new URL(reserveFixture.metadata.url).pathname,
    attestedAt: reserveFixture.generatedAt,
    verified: true,
  },
];

export const SEEDED_WAGER = {
  id: 1,
  title: 'Evening walk — who covered more ground?',
  metricId: 1n,
  stake: 50,
  deadlineBlocksFromNow: 12,
};

export const BADGES: BadgeView[] = [
  {
    id: 1,
    label: 'Streak of 3',
    requirement: '3 consecutive attested workout days',
    minted: false,
  },
  {
    id: 2,
    label: 'Centurion',
    requirement: 'single attested distance ≥ 10 km',
    minted: false,
  },
];

// Deterministic pseudo-random hex of 64 chars (simulated commitment only —
// fixture mode never touches the real hashing pipeline).
export function fakeCommitment(seed: string): string {
  let h = 2166136261;
  for (const c of seed + String(Date.now() % 1_000_000)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5;
    h >>>= 0;
    out += h.toString(16).padStart(8, '0');
  }
  return '0x' + out;
}

export const NOW_MS = () => Date.now();

export const DEADLINE_BLOCK = () => BigInt(1_500_000 + Math.floor(Math.random() * 1_000));

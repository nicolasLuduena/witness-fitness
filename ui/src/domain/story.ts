// Static display constants for the live-only UI (Round 1B — demo/fixture mode
// removed). ATHLETE_A/B, EMPLOYER and BADGES are pure presentation; the
// ATTESTATION_LOG is a typed stub kept EMPTY so wallet-client keeps compiling
// (its attestation flow is replaced by the attest workstream next round — no
// fixture/proof artifacts are embedded anywhere in the UI anymore).

import type { Athlete, BadgeView } from './types';

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

// Typed stub — intentionally empty. Live attestations are built by the
// attest workstream's flow; nothing is pre-recorded in the UI anymore.
export const ATTESTATION_LOG: Array<{
  id: string;
  fixture: unknown;
  host: string;
  path: string;
  attestedAt: string;
  verified: boolean;
}> = [];

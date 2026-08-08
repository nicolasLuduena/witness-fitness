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
  holderBinding: '0x27a00f10f5ea5621dc94654b06d00e0148fa0e637afb69266b661ab6c0c71111',
};

export const ATHLETE_B: Athlete = {
  name: 'Milo Chen',
  handle: 'milo-paces',
  role: 'opponent',
  holderBinding: '0x561c4b3fc95c726f2ad22ae5c83b5fdd39b7c380ad6e8cd844ff87e09cb1f265',
};

export const EMPLOYER: Athlete = {
  name: 'Northwind Wellness',
  handle: 'employer-verifier',
  role: 'other',
  holderBinding: '0x4c690463de80460de26c1f494bd82a1e3f69ba67ffe1a877fd42ea0f38f8560e',
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

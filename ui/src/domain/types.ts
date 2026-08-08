// Domain types shared across the demo client wrapper (fixture + live modes).
// These mirror the contract ABI surface (packages/contract/README.md) but are
// UI-shaped: values that the ledger never reveals are optional and only ever
// populated for the local athlete's own data.

import type { DemoMode } from "../config";

export type { DemoMode };

export type AthleteRole = "local" | "opponent" | "other";

export interface Athlete {
  name: string;
  handle: string;
  role: AthleteRole;
  holderBinding: string; // hex — on-chain identity, never a real name
}

export interface Metric {
  id: bigint;
  label: string;
  unit: string;
  provableChip: (value: number) => string;
}

export const METRICS: Metric[] = [
  {
    id: 1n,
    label: "Distance",
    unit: "km",
    provableChip: (v) => `distance ≥ ${(v / 1000).toFixed(1)} km`,
  },
  {
    id: 2n,
    label: "Moving time",
    unit: "min",
    provableChip: (v) => `moving time ≥ ${Math.round(v / 60)} min`,
  },
];

export const metricById = (id: bigint): Metric => METRICS.find((m) => m.id === id) ?? METRICS[0];

export interface AttestationStage {
  id: string;
  label: string;
  detail: string;
  state: "pending" | "active" | "done" | "error";
}

export interface AttestOutcome {
  credential: AttestedCredential;
  stages: AttestationStage[];
  replayed: boolean; // true when the session came from the attestation log
}

export interface AttestedCredential {
  id: string; // vault key (hex) — on-chain commitment id
  athlete: Athlete;
  source: "live-session" | "fixture-replay" | "demo-story";
  metric: Metric;
  value: number; // raw value, ONLY on the local athlete's machine
  commitment: string; // persistentCommit(assertion, rand) hex
  txHash?: string; // on-chain transaction that vaulted the credential
  timestamp: number; // epoch ms
  provableChips: string[];
  notarySignatures: number; // how many of 3 notaries signed
  assertionId: string; // first bytes of the encoded assertion hash
}

export type WagerStatus = "open" | "accepted" | "submitted" | "settled" | "cancelled";

export interface WagerSubmission {
  athlete: Athlete;
  sealed: boolean; // envelope glyph state
  commitment: string; // on-chain submission commitment (never the value)
  value?: number; // only present after reveal, only if athletes disclose
}

export interface WagerNft {
  tokenType: string;
  txHash: string;
}

export interface WagerResult {
  winner?: Athlete;
  tie: boolean;
  forfeit: boolean;
  pot: number; // display units (tNIGHT in fixture mode, NIGHT in live mode)
  currency: "tNIGHT" | "NIGHT";
  disclosed: boolean; // did the athletes choose to reveal the comparison?
  challengerValue?: number;
  opponentValue?: number;
  nft?: WagerNft | null; // live mode: shielded WitnessFitness NFT to the winner
  summary: string;
}

export interface WagerView {
  id: number;
  title: string;
  metric: Metric;
  stake: number; // tNIGHT
  deadlineBlock: bigint;
  createdAt: number; // epoch ms
  status: WagerStatus;
  challenger: Athlete;
  opponent: Athlete;
  submissions: WagerSubmission[];
  result?: WagerResult;
}

export interface StreakDay {
  day: number; // day index (timestamp / 86400)
  sealed: boolean;
  label: string;
  active: boolean; // is this the current chain position
}

export interface StreakView {
  current: number;
  lastDay: bigint;
  days: StreakDay[];
  chainId: string; // sealed chain commitment hex
}

export interface BadgeView {
  id: number;
  label: string;
  requirement: string;
  minted: boolean;
  mintedAt?: number;
  count?: number; // e.g. 30-day streak count for badge 1
}

export interface BadgeProof {
  badgeId: number;
  badgeLabel: string;
  verifier: string; // verifier binding hex
  proofId: string; // on-chain proof receipt
  verifiedAt: number;
  statement: string; // what was proven, e.g. "Athlete holds 30-day streak badge"
  dataStillSealed: boolean;
}

export interface NotaryInfo {
  index: 0 | 1 | 2;
  url: string;
  keyId: string;
  pubkey: string; // hex
  healthy: boolean;
  lastSeen?: number;
  signatureCount: number; // signatures this notary contributed to the current flow
}

export interface ClientSession {
  mode: DemoMode;
  athlete: Athlete;
  walletConnected: boolean;
  walletLabel: string;
  walletAddress?: string; // wallet mode: shielded address short
  networkId?: string; // wallet mode: network the wallet is on
}

export interface WagerCreateRequest {
  opponent: Athlete;
  metricId: bigint;
  stake: number; // tNIGHT
  deadlineBlock: bigint;
}

export interface WagerSettleResult {
  wager: WagerView;
  reveal: {
    sealedForRoom: boolean; // ledger never reveals non-winning inputs
    comparison?: { challengerValue: number; opponentValue: number }; // only when disclosed
  };
}

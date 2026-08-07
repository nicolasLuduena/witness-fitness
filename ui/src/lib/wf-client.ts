// The demo client wrapper contract (UI-DEMO.md §4): every backend call lives
// behind this interface so fixture fallback is a FLAG, not a rewrite.
//
// Flows mirror NOTARY.md §5: attest → wager → settle; streak → badge →
// proveBadge. Live mode = fixture proof artifacts replayed through the 3
// notary instances (8101-8103) → ≥2 signatures → contract via chain.ts.
// Fixture mode = the same pipeline simulated in-memory, offline, deterministic.

import type {
  AttestedCredential,
  AttestOutcome,
  BadgeProof,
  BadgeView,
  ClientSession,
  NotaryInfo,
  StreakView,
  WagerCreateRequest,
  WagerSettleResult,
  WagerView,
} from '../domain/types';
import type { DemoMode } from '../config';

export type { AttestOutcome } from '../domain/types';

export interface WfClient {
  readonly mode: DemoMode;

  // Connection — returns the active session (athlete identity).
  connect(): Promise<ClientSession>;

  // attest → vault (NOTARY.md §5 flow 1). Runs the staged pipeline:
  // witnessing TLS → proof generated → notarizing → on-chain.
  attest(): Promise<AttestOutcome>;

  vault(): Promise<AttestedCredential[]>;

  // wager → settle (flow 1 continued)
  listWagers(): Promise<WagerView[]>;
  createWager(req: WagerCreateRequest): Promise<WagerView>;
  acceptWager(id: number): Promise<WagerView>;
  submitWorkout(id: number, credentialId: string): Promise<WagerView>;
  settleWager(id: number): Promise<WagerSettleResult>;

  // streak → badge → proveBadge (flow 2)
  streak(): Promise<StreakView>;
  advanceStreak(): Promise<StreakView>;
  badges(): Promise<BadgeView[]>;
  mintBadge(badgeId: number): Promise<BadgeView>;
  proveBadge(badgeId: number, verifier: string): Promise<BadgeProof>;

  // The always-visible trust strip: 3 keys, 2-of-3 counted.
  notaryStatus(): Promise<NotaryInfo[]>;

  // Wallet mode only (Track 0.2): encrypted backup/restore of the private
  // state. Absent on fixture/sidecar clients — screens must feature-check.
  backupPrivateState?(password: string): Promise<string>;
  restorePrivateState?(password: string, payload: string): Promise<void>;
  resetPrivateState?(): Promise<void>;
}

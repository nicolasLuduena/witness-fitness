// Live-wager UI helpers (Phase C): countdown math + challenge-ID parsing.
// The sidecar's settle unlocks at deadlineBlock (unix seconds) + 60 s grace.

export const SETTLE_GRACE_MS = 60_000;

export const settleReadyAtMs = (deadlineBlock: bigint): number =>
  Number(deadlineBlock) * 1000 + SETTLE_GRACE_MS;

export const formatCountdown = (msLeft: number): string => {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
};

// The sidecar's public challenge space is its identity namespace: 'A' (Ava,
// seed ONE) and 'B' (Milo, seed TWO). Holder bindings live sidecar-side and
// resolve to these letters in /wagers.
export const challengeIdOf = (input: string): "A" | "B" | null => {
  const trimmed = input.trim().toUpperCase();
  return trimmed === "A" || trimmed === "B" ? trimmed : null;
};

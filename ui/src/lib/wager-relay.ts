// Two-browser wager relay client (Round 1A stateless surface, :8200).
// Each athlete posts their OWN (value, rand) opening at submit time; the
// settling browser polls until BOTH are present, then stages them into its
// private state for settleWager. The relay never sees the wallet or the
// contract — it is a dumb in-memory exchange (TTL 30 min).
//
// Side convention: the CHALLENGER posts as 'A', the opponent (acceptor) as
// 'B' — matches the contract's challenger/opponent ordering in
// privateState.wagerOpenings = [challengerValue, challengerRand,
// opponentValue, opponentRand].

import { ATTEST_SERVICE_URL } from './attest/config';

export type RelaySide = 'A' | 'B';

// Mutable for tests (vitest cannot wait 60s); the wallet-client reads it per
// settle call.
export const OPENING_RELAY_TIMEOUT = { ms: 60_000 };

export interface RelayOpening {
  who: RelaySide;
  value: string; // 0x-hex (bigint)
  rand: string; // 0x-hex (bigint)
}

export const hexOf = (value: bigint): string => '0x' + value.toString(16);

export const relaySideOf = (isChallenger: boolean): RelaySide => (isChallenger ? 'A' : 'B');

export const postWagerOpening = async (
  wagerId: number,
  who: RelaySide,
  value: bigint,
  rand: bigint,
  serviceUrl: string = ATTEST_SERVICE_URL,
): Promise<void> => {
  const res = await fetch(`${serviceUrl}/wager-openings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wagerId, who, value: hexOf(value), rand: hexOf(rand) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`wager-opening relay failed: ${body?.error ?? `HTTP ${res.status}`}`);
  }
};

export const getWagerOpenings = async (
  wagerId: number,
  serviceUrl: string = ATTEST_SERVICE_URL,
): Promise<RelayOpening[]> => {
  const res = await fetch(`${serviceUrl}/wager-openings/${wagerId}`);
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`wager-opening fetch failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { openings?: RelayOpening[] };
  return body.openings ?? [];
};

// Poll until both sides have relayed their openings (the opponent's arrives
// whenever THEY submit+post). Timeout → a clear error the UI can surface.
export const waitForBothOpenings = async (
  wagerId: number,
  opts: { sides?: RelaySide[]; timeoutMs?: number; pollMs?: number; serviceUrl?: string } = {},
): Promise<{ challenger: RelayOpening; opponent: RelayOpening }> => {
  const sides = opts.sides ?? ['A', 'B'];
  const timeoutMs = opts.timeoutMs ?? OPENING_RELAY_TIMEOUT.ms;
  const pollMs = opts.pollMs ?? 2_000;
  const serviceUrl = opts.serviceUrl;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const openings = await getWagerOpenings(wagerId, serviceUrl);
    const bySide = new Map(openings.map((o) => [o.who, o]));
    const challenger = bySide.get('A');
    const opponent = bySide.get('B');
    if (challenger && opponent) {
      return { challenger, opponent };
    }
    if (Date.now() > deadline) {
      const missing = sides.filter((s) => !bySide.has(s)).join(' and ');
      throw new Error(
        `opponent's sealed opening (${missing}) never reached the relay — retry settle once both athletes have submitted`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
};

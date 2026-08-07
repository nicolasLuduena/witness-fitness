// Live-wager tests (Phase C): the full create → accept → submit(A+B) →
// settle → reveal mapping against a stubbed sidecar, plus the countdown and
// challenge-ID helpers. The stub mirrors the sidecar's wager endpoints
// (demo-sidecar.ts) — same request/response shapes, hex wire format.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LiveClient, hexOf, nightToDisplay } from './live-client';
import { challengeIdOf, formatCountdown, settleReadyAtMs } from './wager-countdown';

const NIGHT_BASE = 10n ** 12n;
const HEX = (v: bigint | number) => '0x' + BigInt(v).toString(16);

interface StubWager {
  id: bigint;
  challenger: 'A' | 'B';
  opponent: 'A' | 'B';
  metricId: bigint;
  stake: bigint;
  deadlineBlock: bigint;
  accepted: boolean;
  settled: boolean;
  challengerSubmitted: boolean;
  opponentSubmitted: boolean;
  values: { A?: bigint; B?: bigint };
  winner: 'A' | 'B' | 'tie' | null;
}

type RouteHandler = (body?: Record<string, unknown>) => { status: number; json: Record<string, unknown> };

const installStubSidecar = (): { records: Map<bigint, StubWager> } => {
  const records = new Map<bigint, StubWager>();
  const routes = new Map<string, RouteHandler>();

  routes.set('/health', () => ({
    status: 200,
    json: { ok: true, contractAddress: '0xcf80ad42', network: 'devnet' },
  }));
  routes.set('/state', () => ({ status: 200, json: { vault: [], streaks: null, badges: [] } }));
  routes.set('/wagers', () => ({
    status: 200,
    json: {
      wagers: [...records.values()].map((w) => ({
        id: HEX(w.id),
        challenger: w.challenger,
        opponent: w.opponent,
        metricId: HEX(w.metricId),
        stake: HEX(w.stake),
        deadlineBlock: HEX(w.deadlineBlock),
        accepted: w.accepted,
        settled: w.settled,
        challengerSubmitted: w.challengerSubmitted,
        opponentSubmitted: w.opponentSubmitted,
        winner: w.winner,
      })),
    },
  }));
  routes.set('/wager/create', (body) => {
    const id = BigInt(records.size);
    const record: StubWager = {
      id,
      challenger: body?.athlete === 'B' ? 'B' : 'A',
      opponent: body?.opponent === 'B' ? 'B' : 'A',
      metricId: BigInt(String(body?.metricId ?? '0x1')),
      stake: BigInt(String(body?.stake ?? '0')),
      deadlineBlock: BigInt(String(body?.deadlineBlock ?? '0')),
      accepted: false,
      settled: false,
      challengerSubmitted: false,
      opponentSubmitted: false,
      values: {},
      winner: null,
    };
    records.set(id, record);
    return {
      status: 200,
      json: {
        wagerId: HEX(id),
        txHash: HEX(0xabc),
        challenger: record.challenger,
        opponent: record.opponent,
        metricId: HEX(record.metricId),
        stake: HEX(record.stake),
        deadlineBlock: HEX(record.deadlineBlock),
      },
    };
  });
  routes.set('/wager/accept', (body) => {
    const id = BigInt(String(body?.id ?? '0'));
    const record = records.get(id);
    if (!record) return { status: 404, json: { error: 'unknown wager — create it first' } };
    if (body?.athlete !== record.opponent) {
      return { status: 400, json: { error: `only the opponent (${record.opponent}) can accept` } };
    }
    record.accepted = true;
    return { status: 200, json: { id: HEX(id), athlete: body?.athlete, accepted: true, txHash: HEX(0xdef) } };
  });
  routes.set('/wager/submit', (body) => {
    const id = BigInt(String(body?.id ?? '0'));
    const record = records.get(id);
    if (!record) return { status: 404, json: { error: 'unknown wager — create it first' } };
    const athlete = body?.athlete === 'B' ? 'B' : 'A';
    if (athlete === 'A') record.challengerSubmitted = true;
    else record.opponentSubmitted = true;
    record.values[athlete] = athlete === 'A' ? 3545n : 2426n;
    return { status: 200, json: { id: HEX(id), athlete, submitted: true, txHash: HEX(0x111) } };
  });
  routes.set('/wager/settle', (body) => {
    const id = BigInt(String(body?.id ?? '0'));
    const record = records.get(id);
    if (!record) return { status: 404, json: { error: 'unknown wager — create it first' } };
    if (!record.accepted) return { status: 400, json: { error: 'wager not accepted' } };
    const a = record.values.A ?? 0n;
    const b = record.values.B ?? 0n;
    record.winner = a > b ? 'A' : b > a ? 'B' : 'tie';
    record.settled = true;
    return {
      status: 200,
      json: {
        id: HEX(id),
        winner: record.winner,
        potNIGHT: HEX(2n * record.stake),
        nft:
          record.winner === 'tie'
            ? null
            : { tokenType: '0x00f00d', txHash: HEX(0x777) },
        disclosed: { A: HEX(a), B: HEX(b) },
        txHash: HEX(0x777),
      },
    };
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const handler = routes.get(path);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const { status, json } = handler ? handler(body) : { status: 404, json: { error: 'not found' } };
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  return { records };
};

describe('live wager flow (stubbed sidecar)', () => {
  let client: LiveClient;

  beforeEach(() => {
    installStubSidecar();
    client = new LiveClient();
  });

  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('create → accept → submit both → settle → reveal mapping', async () => {
    await client.connect();

    const deadlineBlock = BigInt(Math.floor(Date.now() / 1000) + 90);
    const created = await client.createWager({
      opponent: { name: 'Milo Chen', handle: 'milo-paces', role: 'opponent', holderBinding: 'B' },
      metricId: 1n,
      stake: 10,
      deadlineBlock,
    });
    expect(created.status).toBe('open');
    expect(created.opponent.handle).toBe('milo-paces');
    expect(created.stake).toBe(10);
    expect(created.deadlineBlock).toBe(deadlineBlock);

    const accepted = await client.acceptWager(created.id);
    expect(accepted.status).toBe('accepted');

    const afterA = await client.submitWorkout(created.id, 'A');
    expect(afterA.submissions.some((s) => s.athlete.handle === 'ava-runs')).toBe(true);
    expect(afterA.status).toBe('accepted');

    const afterB = await client.submitWorkout(created.id, 'B');
    expect(afterB.submissions).toHaveLength(2);
    expect(afterB.status).toBe('submitted');

    const settled = await client.settleWager(created.id);
    expect(settled.wager.status).toBe('settled');
    expect(settled.wager.result?.winner?.handle).toBe('ava-runs');
    expect(settled.wager.result?.tie).toBe(false);
    expect(settled.wager.result?.pot).toBe(20);
    expect(settled.wager.result?.currency).toBe('NIGHT');
    expect(settled.wager.result?.challengerValue).toBe(3545);
    expect(settled.wager.result?.opponentValue).toBe(2426);
    expect(settled.wager.result?.nft?.tokenType).toBe('0x00f00d');
    expect(settled.reveal.sealedForRoom).toBe(true);
    expect(settled.reveal.comparison).toEqual({ challengerValue: 3545, opponentValue: 2426 });
  });

  it('listWagers maps a settled entry with winner + envelopes', async () => {
    await client.connect();
    const deadlineBlock = BigInt(Math.floor(Date.now() / 1000) + 90);
    const created = await client.createWager({
      opponent: { name: 'Milo Chen', handle: 'milo-paces', role: 'opponent', holderBinding: 'B' },
      metricId: 1n,
      stake: 10,
      deadlineBlock,
    });
    await client.acceptWager(created.id);
    await client.submitWorkout(created.id, 'A');
    await client.submitWorkout(created.id, 'B');
    await client.settleWager(created.id);

    const wagers = await client.listWagers();
    const settled = wagers.find((w) => w.id === created.id);
    expect(settled?.status).toBe('settled');
    expect(settled?.submissions).toHaveLength(2);
    expect(settled?.result?.summary).toContain('Ava');
  });

  it('sidecar 4xx domain errors surface verbatim (deadline/unknown)', async () => {
    await client.connect();
    // acceptWager pre-checks the roster locally; submitWorkout passes straight
    // through to the sidecar — the 404 body must surface verbatim.
    await expect(client.submitWorkout(999, 'A')).rejects.toThrow('unknown wager — create it first');
    await expect(client.acceptWager(999)).rejects.toThrow('wager 999 not found');
  });
});

describe('wager countdown + challenge-ID helpers', () => {
  it('settleReadyAtMs = deadlineBlock seconds + 60 s grace', () => {
    const deadlineBlock = BigInt(1_800_000_000);
    expect(settleReadyAtMs(deadlineBlock)).toBe(1_800_000_000_000 + 60_000);
  });

  it('formatCountdown renders mm:ss, floors at zero', () => {
    expect(formatCountdown(90_000)).toBe('1:30');
    expect(formatCountdown(5_000)).toBe('0:05');
    expect(formatCountdown(-1)).toBe('0:00');
  });

  it('challengeIdOf accepts A/B case-insensitively, rejects anything else', () => {
    expect(challengeIdOf('B')).toBe('B');
    expect(challengeIdOf(' a ')).toBe('A');
    expect(challengeIdOf('0x1234')).toBeNull();
    expect(challengeIdOf('')).toBeNull();
  });
});

describe('NIGHT display conversion', () => {
  it('base units → display NIGHT', () => {
    expect(nightToDisplay(Number(10n * NIGHT_BASE))).toBe(10);
    expect(nightToDisplay(Number(20n * NIGHT_BASE))).toBe(20);
  });

  it('hexOf roundtrips bigints', () => {
    expect(hexOf(10n * NIGHT_BASE)).toBe('0x9184e72a000');
  });
});

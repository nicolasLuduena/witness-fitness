// Smoke tests for the fixture-mode demo client — the path the demo actually
// runs. Guards the demo story: attest → vault, wager lifecycle, sealed
// settle, streak → badge → proveBadge.

import { describe, expect, it } from 'vitest';
import { FixtureClient } from './fixture-client';

const settleByPolling = async (
  client: FixtureClient,
  wagerId: number,
  attempts = 20
): Promise<void> => {
  for (let i = 0; i < attempts; i += 1) {
    const wagers = await client.listWagers();
    const wager = wagers.find((w) => w.id === wagerId);
    if (wager?.submissions.length === 2) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('opponent submission never landed');
};

describe('fixture client (demo path)', () => {
  it('connects as the demo athlete', async () => {
    const client = new FixtureClient();
    const session = await client.connect();
    expect(session.mode).toBe('fixture');
    expect(session.athlete.handle).toBe('ava-runs');
  });

  it('attest → vault: staged pipeline, credential lands sealed', async () => {
    const client = new FixtureClient();
    const before = (await client.vault()).length;
    const outcome = await client.attest();
    expect(outcome.stages.every((s) => s.state === 'done')).toBe(true);
    expect(outcome.replayed).toBe(true);
    const after = await client.vault();
    expect(after.length).toBe(before + 1);
    const newest = after[0];
    expect(newest.notarySignatures).toBeGreaterThanOrEqual(2);
    expect(newest.commitment.startsWith('0x')).toBe(true);
    expect(newest.provableChips.length).toBeGreaterThan(0);
  });

  it('wager lifecycle: accept → submit → opponent seals → settle (values stay hidden until disclose)', async () => {
    const client = new FixtureClient();
    await client.connect();
    const seeded = (await client.listWagers()).find((w) => w.id === 1);
    expect(seeded?.status).toBe('open');

    await client.acceptWager(1);
    const creds = await client.vault();
    await client.submitWorkout(1, creds[0].id);
    await settleByPolling(client, 1);

    const submitted = (await client.listWagers()).find((w) => w.id === 1);
    expect(submitted?.submissions.length).toBe(2);
    expect(submitted?.submissions.every((s) => s.sealed)).toBe(true);

    const settled = await client.settleWager(1);
    expect(settled.wager.status).toBe('settled');
    expect(settled.wager.result?.winner?.handle).toBe('ava-runs'); // 12.4 km > 8.1 km
    expect(settled.wager.result?.pot).toBe(100);
    expect(settled.reveal.sealedForRoom).toBe(true);
    expect(settled.reveal.comparison?.challengerValue).toBeGreaterThan(
      settled.reveal.comparison?.opponentValue ?? 0
    );
  });

  it('streak → badge → proveBadge: chain advances, badge mints, proof keeps data sealed', async () => {
    const client = new FixtureClient();
    await client.connect();
    expect((await client.streak()).current).toBe(2);

    const advanced = await client.advanceStreak();
    expect(advanced.current).toBe(3);
    expect(advanced.days.some((d) => d.sealed && d.label === 'TODAY')).toBe(true);

    const minted = await client.mintBadge(1);
    expect(minted.minted).toBe(true);
    expect(minted.count).toBe(3);

    const proof = await client.proveBadge(1, 'employer@northwind.example');
    expect(proof.statement).toContain('Streak of 3');
    expect(proof.dataStillSealed).toBe(true);
    expect(proof.proofId.startsWith('0x')).toBe(true);

    await expect(client.mintBadge(1)).resolves.toMatchObject({ minted: true });
    await expect(client.proveBadge(2, 'x')).rejects.toThrow('not minted');
  });

  it('notary strip reports 3 registered keys with 2-of-3 signature accounting', async () => {
    const client = new FixtureClient();
    const status = await client.notaryStatus();
    expect(status).toHaveLength(3);
    expect(status.every((n) => n.healthy)).toBe(true);
    await client.attest();
    const after = await client.notaryStatus();
    const signed = after.filter((n) => n.signatureCount > 0);
    expect(signed.length).toBeGreaterThanOrEqual(2);
  });
});

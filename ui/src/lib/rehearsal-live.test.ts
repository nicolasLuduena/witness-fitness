// LIVE-path rehearsal — opt-in: REHEARSE=live pnpm --filter ui exec vitest run src/lib/rehearsal-live.test.ts
// Walks the demo's live beats against the running sidecar (:8200) and records
// timings + outcomes. Not part of the default suite (needs the full stack up).
// Expected on the current corrupt-node devnet: reads OK, submits fail (see
// DEMO-PLAYBOOK.md "Known demo limits").

import { describe, expect, it } from 'vitest';
import { LiveClient } from './live-client';

const enabled = process.env.REHEARSE === 'live';

describe.skipIf(!enabled)('live rehearsal (sidecar :8200)', () => {
  it(
    'connect → state reads → submit paths',
    async () => {
      const client = new LiveClient();
      console.log(
        '[rehearsal] WARNING: attest() consumes the FIRST entry of ATTESTATION_LOG on-chain — regenerate a fixture (packages/client/src/rehearse-fixtures.ts) before running if the demo reserve must stay intact'
      );
      const t0 = Date.now();
      const session = await client.connect();
      console.log(`[rehearsal] connect ${Date.now() - t0}ms | contract ${session.walletLabel}`);
      expect(session.mode).toBe('live');

      const t1 = Date.now();
      const vault = await client.vault();
      console.log(`[rehearsal] vault() ${Date.now() - t1}ms | ${vault.length} entries`);
      expect(Array.isArray(vault)).toBe(true);

      const t2 = Date.now();
      const streak = await client.streak();
      console.log(`[rehearsal] streak() ${Date.now() - t2}ms | current=${streak.current} lastDay=${streak.lastDay}`);
      expect(typeof streak.current).toBe('number');

      const badges = await client.badges();
      console.log(`[rehearsal] badges() | ${badges.length} catalog entries`);
      expect(badges).toHaveLength(2);

      const t3 = Date.now();
      const status = await client.notaryStatus();
      console.log(`[rehearsal] notaryStatus() ${Date.now() - t3}ms | up=${status.filter((n) => n.healthy).length}/3`);
      expect(status).toHaveLength(3);

      const t4 = Date.now();
      try {
        await client.attest();
        console.log(`[rehearsal] attest() OK ${Date.now() - t4}ms — credential vaulted`);
      } catch (err) {
        console.log(`[rehearsal] attest() FAILED ${Date.now() - t4}ms — ${(err as Error).message.slice(0, 160)}`);
      }

      const t5 = Date.now();
      try {
        await client.advanceStreak();
        console.log(`[rehearsal] advanceStreak() OK ${Date.now() - t5}ms`);
      } catch (err) {
        console.log(`[rehearsal] advanceStreak() FAILED ${Date.now() - t5}ms — ${(err as Error).message.slice(0, 160)}`);
      }

      // Badge predicate behavior — expected denials on a github fixture
      // (distance = stargazers_count ≈ 84 < 10_000; streak < 3):
      const t6 = Date.now();
      try {
        const minted = await client.mintBadge(2);
        console.log(`[rehearsal] mintBadge(2) OK ${Date.now() - t6}ms — minted=${minted.minted}`);
      } catch (err) {
        console.log(`[rehearsal] mintBadge(2) DENIED ${Date.now() - t6}ms — ${(err as Error).message.slice(0, 160)}`);
      }

      const t7 = Date.now();
      try {
        await client.proveBadge(1, 'employer@northwind.example');
        console.log(`[rehearsal] proveBadge(1) OK ${Date.now() - t7}ms`);
      } catch (err) {
        console.log(`[rehearsal] proveBadge(1) DENIED ${Date.now() - t7}ms — ${(err as Error).message.slice(0, 160)}`);
      }

      const t8 = Date.now();
      const after = await client.vault();
      const afterStreak = await client.streak();
      console.log(`[rehearsal] post-state: vault=${after.length} entries, streak=${afterStreak.current} | ${Date.now() - t8}ms`);
    },
    90_000
  );
});

// Guards for the live path: the sidecar delegation layer must fail fast and
// clearly when the demo service is absent, and the fixture path must never
// depend on it.

import { describe, expect, it } from 'vitest';
import { FixtureClient } from './fixture-client';
import { joinSidecar, SidecarOfflineError } from './chain';

const DEAD_PORT = 'http://127.0.0.1:1';

describe('live path (sidecar delegation)', () => {
  it('joinSidecar rejects with a clear offline error when the sidecar is down', async () => {
    await expect(joinSidecar(DEAD_PORT)).rejects.toThrow(SidecarOfflineError);
    await expect(joinSidecar(DEAD_PORT)).rejects.toThrow(/offline|switch to demo mode/);
  });

  it('fixture mode works without any sidecar or chain', async () => {
    const client = new FixtureClient();
    const session = await client.connect();
    expect(session.mode).toBe('fixture');
    const outcome = await client.attest();
    expect(outcome.credential.provableChips.length).toBeGreaterThan(0);
  });

  it('fixture notaryStatus degrades to the embedded registry when deploy-output.json is absent', async () => {
    const client = new FixtureClient();
    const status = await client.notaryStatus();
    expect(status).toHaveLength(3);
    expect(status.every((n) => n.healthy)).toBe(true);
    expect(status.every((n) => n.pubkey.length > 16)).toBe(true);
  });
});

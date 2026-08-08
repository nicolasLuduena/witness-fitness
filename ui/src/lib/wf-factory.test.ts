// Proxy-drift guard (wf-factory): every WfClient member — including the
// OPTIONAL ones, which `implements` does not enforce — must be exposed by
// both proxies. The "Connect Strava — OAuth did absolutely nothing" bug was
// exactly this: connectStrava/handleStravaRedirect/stravaStatus were never
// forwarded, and `client.connectStrava?.()` silently no-opped.
import { describe, expect, it } from "vitest";
import { createWfClient } from "./wf-factory";

const MEMBERS = [
  "connect",
  "attest",
  "vault",
  "listWagers",
  "createWager",
  "acceptWager",
  "submitWorkout",
  "settleWager",
  "streak",
  "advanceStreak",
  "badges",
  "mintBadge",
  "proveBadge",
  "notaryStatus",
  "backupPrivateState",
  "restorePrivateState",
  "resetPrivateState",
  "stravaStatus",
  "connectStrava",
  "handleStravaRedirect",
] as const;

describe("wf-factory proxy surface", () => {
  it("every WfClient member (incl. optional) is exposed by the wallet proxy", () => {
    const proxy = createWfClient("wallet") as unknown as Record<string, unknown>;
    for (const member of MEMBERS) {
      expect(typeof proxy[member], `wallet.${member}`).toBe("function");
    }
  });

  it("every WfClient member (incl. optional) is exposed by the live proxy", () => {
    const proxy = createWfClient("live") as unknown as Record<string, unknown>;
    for (const member of MEMBERS) {
      expect(typeof proxy[member], `live.${member}`).toBe("function");
    }
  });

  it("wallet proxy stravaStatus is synchronous and reflects the inner client", async () => {
    const proxy = createWfClient("wallet");
    expect(proxy.stravaStatus!()).toEqual({ connected: false });
    // connectStrava before connect → honest sync error, not a silent no-op.
    expect(() => proxy.connectStrava!()).toThrow(/wallet not connected/);
    // Without a wallet extension (or a window, in vitest), connect() fails;
    // stravaStatus stays honest either way.
    await expect(proxy.connect()).rejects.toThrow();
    expect(proxy.stravaStatus!()).toEqual({ connected: false });
  });

  it("live proxy wallet-only members fail with descriptive errors, not silent no-ops", () => {
    const proxy = createWfClient("live");
    expect(() => proxy.connectStrava!()).toThrow(/wallet-mode only/);
    expect(proxy.stravaStatus!()).toEqual({ connected: false });
  });
});

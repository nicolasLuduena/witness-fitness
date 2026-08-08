// Guards for the live path: the sidecar delegation layer must fail fast and
// clearly when the service is absent, and the attest path must fail clearly
// while the attest workstream's flow replaces the (now removed) fixture log.

import { describe, expect, it } from "vitest";
import { joinSidecar, SidecarOfflineError } from "./chain";
import { LiveClient } from "./live-client";

const DEAD_PORT = "http://127.0.0.1:1";

describe("live path (sidecar delegation)", () => {
  it("joinSidecar rejects with a clear offline error when the sidecar is down", async () => {
    await expect(joinSidecar(DEAD_PORT)).rejects.toThrow(SidecarOfflineError);
    await expect(joinSidecar(DEAD_PORT)).rejects.toThrow(/offline|switch to demo mode/);
  });

  it("attest fails clearly while the attestation log is empty (Round 1B)", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, contractAddress: "0xdead", network: "devnet" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      const client = new LiveClient();
      await client.connect();
      await expect(client.attest()).rejects.toThrow(/no attestation source — use wallet mode/);
    } finally {
      delete (globalThis as { fetch?: unknown }).fetch;
    }
  });
});

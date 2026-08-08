// Stateless surface tests (Round 1A): attestor auth-request relay, strava
// token relay (exchange/refresh — fetch mocked), wager-openings relay
// (deposit/get/isolate/TTL), CORS on the new paths, and the extended /health
// shape. The stateless endpoints bypass the ready gate, so cold sidecars are
// used (no wallet init, no fake deps needed).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";

// The tests' own HTTP calls must NOT go through the per-test fetch mocks.
const realFetch = globalThis.fetch;
import {
  createDemoSidecarWithDeps,
  loadSidecarConfig,
  type DemoSidecarConfig,
} from "../src/demo-sidecar.js";

const baseConfig = (overrides: Partial<DemoSidecarConfig> = {}): DemoSidecarConfig => ({
  ...loadSidecarConfig({}),
  port: 0,
  contractAddress: "0xdeadbeef",
  notaryUrls: ["http://127.0.0.1:1"],
  txTimeoutMs: 5_000,
  notaryTimeoutMs: 5_000,
  walletInitTimeoutMs: 5_000,
  attestorPrivateKey: "0x" + "11".repeat(32),
  attestorUserId: "wf-test",
  attestorHostWhitelist: ["www.strava.com"],
  stravaClientId: "client-id-test",
  stravaClientSecret: "client-secret-test",
  openingsTtlMs: 60_000,
  ...overrides,
});

const start = async (
  config: DemoSidecarConfig,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const side = createDemoSidecarWithDeps(config, null);
  await new Promise<void>((resolve) => side.server.listen(0, resolve));
  const { port } = side.server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => side.close() };
};

const post = (url: string, path: string, body: unknown): Promise<Response> =>
  realFetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("stateless surface", () => {
  let url: string;
  let closeAll: () => Promise<void>;

  beforeAll(async () => {
    const started = await start(baseConfig());
    url = started.url;
    closeAll = started.close;
  });

  afterAll(async () => {
    await closeAll();
  });

  it("POST /attestor-auth-request returns a usable authRequest (strava whitelist)", async () => {
    const res = await post(url, "/attestor-auth-request", {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authRequest: { data?: { id?: string; hostWhitelist?: string[] }; signature?: string };
    };
    expect(body.authRequest.data?.id).toBe("wf-test");
    expect(body.authRequest.data?.hostWhitelist).toContain("www.strava.com");
    expect(typeof body.authRequest.signature).toBe("string");
    expect(body.authRequest.signature).toMatch(/^0x/);
  });

  it("POST /attestor-auth-request fails clearly without the attestor key", async () => {
    const noKey = await start(baseConfig({ attestorPrivateKey: "" }));
    try {
      const res = await post(noKey.url, "/attestor-auth-request", {});
      expect(res.status).toBe(500);
      expect(((await res.json()) as Record<string, unknown>).error).toMatch(/ATTESTOR_PRIVATE_KEY/);
    } finally {
      await noKey.close();
    }
  });

  it("POST /strava/exchange posts grant_type=authorization_code and never leaks the secret", async () => {
    const originalFetch = globalThis.fetch;
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({
          access_token: "tok-abc",
          refresh_token: "tok-ref",
          expires_at: 1786000000,
          athlete: { id: 42, firstname: "N", lastname: "L" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const res = await post(url, "/strava/exchange", { code: "auth-code-1" });
      expect(res.status).toBe(200);
      expect(captured?.url).toBe("https://www.strava.com/oauth/token");
      expect(captured?.body).toMatchObject({
        client_id: "client-id-test",
        client_secret: "client-secret-test",
        code: "auth-code-1",
        grant_type: "authorization_code",
      });
      const text = await res.text();
      expect(text).not.toContain("client-secret-test");
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(body.access_token).toBe("tok-abc");
      expect((body.athlete as { id: number }).id).toBe(42);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("POST /strava/exchange maps upstream failure to 400", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "bad grant" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      const res = await post(url, "/strava/exchange", { code: "bad-code" });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Record<string, unknown>).error).toMatch(/bad grant/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("POST /strava/refresh posts grant_type=refresh_token", async () => {
    const originalFetch = globalThis.fetch;
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({
          access_token: "tok-2",
          refresh_token: "tok-ref-2",
          expires_at: 1786000100,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const res = await post(url, "/strava/refresh", { refresh_token: "old-refresh" });
      expect(res.status).toBe(200);
      expect(captured?.url).toBe("https://www.strava.com/oauth/token");
      expect(captured?.body).toMatchObject({
        refresh_token: "old-refresh",
        grant_type: "refresh_token",
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.access_token).toBe("tok-2");
      expect(JSON.stringify(body)).not.toContain("client-secret-test");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("POST /strava/exchange rejects a missing code", async () => {
    const res = await post(url, "/strava/exchange", {});
    expect(res.status).toBe(400);
  });

  it("wager-openings: deposit two, GET returns both; per-wager isolation; 404 before deposit", async () => {
    const res404 = await fetch(`${url}/wager-openings/w-1`);
    expect(res404.status).toBe(404);

    const d1 = await post(url, "/wager-openings", {
      wagerId: "w-1",
      who: "A",
      value: "0x1",
      rand: "0x2",
    });
    expect(d1.status).toBe(200);
    expect(await d1.json()).toEqual({ stored: true });
    const d2 = await post(url, "/wager-openings", {
      wagerId: "w-1",
      who: "B",
      value: "0x3",
      rand: "0x4",
    });
    expect(d2.status).toBe(200);

    const got = await fetch(`${url}/wager-openings/w-1`);
    expect(got.status).toBe(200);
    const body = (await got.json()) as { openings: { who: string; value: string; rand: string }[] };
    expect(body.openings).toEqual([
      { who: "A", value: "0x1", rand: "0x2" },
      { who: "B", value: "0x3", rand: "0x4" },
    ]);

    const other = await fetch(`${url}/wager-openings/w-2`);
    expect(other.status).toBe(404);

    const invalid = await post(url, "/wager-openings", {
      wagerId: "w-3",
      who: "A",
      value: "not-hex",
      rand: "0x2",
    });
    expect(invalid.status).toBe(400);
  });

  it("wager-openings: TTL expiry returns 404 (short TTL)", async () => {
    const short = await start(baseConfig({ openingsTtlMs: 100 }));
    try {
      const d = await post(short.url, "/wager-openings", {
        wagerId: "w-ttl",
        who: "A",
        value: "0x1",
        rand: "0x2",
      });
      expect(d.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const got = await fetch(`${short.url}/wager-openings/w-ttl`);
      expect(got.status).toBe(404);
    } finally {
      await short.close();
    }
  });

  it("CORS covers the new endpoints (OPTIONS → 204 + headers)", async () => {
    const preflight = await fetch(`${url}/attestor-auth-request`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");

    await post(url, "/wager-openings", { wagerId: "w-cors", who: "A", value: "0x1", rand: "0x2" });
    const res = await fetch(`${url}/wager-openings/w-cors`, {
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("/health exposes the stateless flags (booleans only, never values)", async () => {
    const health = await fetch(`${url}/health`);
    const body = (await health.json()) as Record<string, unknown>;
    expect(body.stateless).toBe(true);
    expect(typeof body.hasStrava).toBe("boolean");
    expect(typeof body.hasAttestorKey).toBe("boolean");
    expect(JSON.stringify(body)).not.toContain("client-secret-test");
    expect(JSON.stringify(body)).not.toContain("11".repeat(32));

    const noKey = await start(baseConfig({ attestorPrivateKey: "" }));
    try {
      const h2 = (await (await fetch(`${noKey.url}/health`)).json()) as Record<string, unknown>;
      expect(h2.hasAttestorKey).toBe(false);
    } finally {
      await noKey.close();
    }
  });
});

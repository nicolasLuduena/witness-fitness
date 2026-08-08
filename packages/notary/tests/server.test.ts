// NOTARY.md §6.4 / §4 — the HTTP API surface: POST /attestate returns
// { assertion, signature, notaryId }; /health and /pubkey expose instance
// identity. Tampered artifacts get a loud 400.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createNotaryServer, type NotaryServer } from "../src/index.js";
import { DEFAULT_ALLOWED_HOSTS, loadConfig, type NotaryConfig } from "../src/config.js";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "client",
  "fixtures",
);

const baseConfig: NotaryConfig = {
  notaryKey: "00".repeat(32),
  notaryId: "test-notary",
  port: 0,
  attestorUrl: "ws://localhost:8001/ws",
  contractAddress: "0xabc",
  nodeUrl: "http://127.0.0.1:9944",
  indexerUrl: "http://127.0.0.1:8088/api/v3/graphql",
  proofServerUrl: "http://127.0.0.1:6300",
  allowedHosts: DEFAULT_ALLOWED_HOSTS,
  maxBodyBytes: 10_000_000,
};

describe("notary HTTP API", () => {
  let app: NotaryServer;
  let baseUrl: string;

  beforeAll(async () => {
    app = createNotaryServer(baseConfig);
    await new Promise<void>((resolve) => app.server.listen(0, resolve));
    const { port } = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    app.server.close();
  });

  it("OPTIONS preflight with an allowed origin → 204 + CORS headers", async () => {
    const res = await fetch(`${baseUrl}/attestate`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("GET /health with an allowed Origin → CORS header present", async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { origin: "http://127.0.0.1:4173" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4173");
  });

  it("GET /health with a disallowed origin → no CORS header", async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { origin: "http://evil.example" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("GET /health reports instance identity", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.notaryId).toBe("test-notary");
    expect(typeof body.keyId).toBe("string");
    expect(body.publicKey).toHaveProperty("x");
  });

  it("GET /pubkey returns the registered public key", async () => {
    const res = await fetch(`${baseUrl}/pubkey`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.registeredPublicKey).toHaveProperty("x");
    expect(body.registered).toBe(true);
  });

  it("POST /attestate signs a genuine fixture proof", async () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "fixture-github-attestor-core-x-0m.json"), "utf-8"),
    );
    const res = await fetch(`${baseUrl}/attestate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proofArtifacts: fixture }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.notaryId).toBe("test-notary");
    expect(body.assertion).toHaveProperty("version");
    expect(body.signature).toHaveProperty("announcement");
    expect(body.signature).toHaveProperty("response");
    expect(body.metricSource).toBe("fixture-demo");
  });

  it("POST /attestate rejects a tampered artifact with 400", async () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "fixture-github-attestor-core-x-0m.json"), "utf-8"),
    );
    const tampered = {
      ...fixture,
      signatureHex: "0x" + "ab".repeat(65),
    };
    const res = await fetch(`${baseUrl}/attestate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proofArtifacts: tampered }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("POST /attestate rejects an unallowed host with 400", async () => {
    const app2 = createNotaryServer({
      ...baseConfig,
      allowedHosts: ["www.strava.com"],
    });
    await new Promise<void>((resolve) => app2.server.listen(0, resolve));
    const { port } = app2.server.address() as AddressInfo;
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "fixture-github-attestor-core-x-0m.json"), "utf-8"),
    );
    const res = await fetch(`http://127.0.0.1:${port}/attestate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proofArtifacts: fixture }),
    });
    expect(res.status).toBe(400);
    app2.server.close();
  });

  it("loadConfig validates the key format", () => {
    expect(() => loadConfig({ NOTARY_KEY: "xyz", NOTARY_ID: "n" })).toThrow(/32-byte hex scalar/);
    const cfg = loadConfig({ NOTARY_KEY: "0x" + "11".repeat(32), NOTARY_ID: "n" });
    expect(cfg.port).toBe(8101);
  });
});

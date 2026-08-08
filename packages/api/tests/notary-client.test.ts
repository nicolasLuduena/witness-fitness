// Client-glue parity (NOTARY.md §5): NotaryClient collects ≥2 signatures over
// the wire (hex format), the packaged transaction data decodes back into the
// compiled A_Assertion/SchnorrSignature types, and the contract simulator
// ACCEPTS the packaged attestation. Also: a downed instance degrades to the
// remaining 2; inconsistent assertions across instances are rejected.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateState, type PrivateState } from "@witnessfitness/contract";
import { createNotaryServer } from "@witnessfitness/notary";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type NotarizedAttestation, NotaryClient } from "../src/index.js";
import { StrideSim } from "./helpers/sim.js";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "client",
  "fixtures",
);
const fixture = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "fixture-github-attestor-core-x-0m.json"), "utf-8"),
);

const NOTARY_SKS = [0x11111111n, 0x22222222n, 0x33333333n];

const startNotary = async (
  i: number,
): Promise<{
  url: string;
  publicKey: { x: bigint; y: bigint };
  server: Awaited<ReturnType<typeof createNotaryServer>>["server"];
}> => {
  const app = createNotaryServer({
    notaryKey: NOTARY_SKS[i].toString(16).padStart(64, "0"),
    notaryId: `test-notary-${i + 1}`,
    port: 0,
    attestorUrl: "ws://localhost:8001/ws",
    contractAddress: "0xabc",
    nodeUrl: "http://127.0.0.1:9944",
    indexerUrl: "http://127.0.0.1:8088/api/v3/graphql",
    proofServerUrl: "http://127.0.0.1:6300",
    allowedHosts: ["api.github.com", "strava.com"],
    maxBodyBytes: 10_000_000,
  });
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const { port } = app.server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, publicKey: app.publicKey, server: app.server };
};

const adminSecret = randomBytes(32);
const holderSecret = randomBytes(32);
const ps = (overrides: Partial<PrivateState> = {}): PrivateState => ({
  ...createPrivateState(adminSecret, holderSecret),
  ...overrides,
});

describe("notary client glue", () => {
  let urls: string[];
  let pks: { x: bigint; y: bigint }[];
  let servers: Awaited<ReturnType<typeof startNotary>>[];

  beforeAll(async () => {
    servers = [];
    urls = [];
    pks = [];
    for (let i = 0; i < 3; i += 1) {
      const s = await startNotary(i);
      servers.push(s);
      urls.push(s.url);
      pks.push(s.publicKey);
    }
  });

  afterAll(() => {
    for (const s of servers) {
      s.server.close();
    }
  });

  it("collects 3 signatures over one identical assertion (wire roundtrip)", async () => {
    const client = new NotaryClient(urls);
    const attestation = await client.attestate(fixture);
    expect(attestation.signatures).toHaveLength(3);
    expect(attestation.assertion.nonce).toHaveLength(32);
    expect(attestation.assertion.reclaimProofHash).toHaveLength(32);
    expect(attestation.metricSource).toBe("fixture-demo");
  });

  it("packaged attestation is ACCEPTED by the contract simulator", async () => {
    const client = new NotaryClient(urls);
    const attestation: NotarizedAttestation = await client.attestate(fixture);
    const sim = new StrideSim(ps());
    sim.call("registerAdmin", ps());
    for (let i = 0; i < 3; i += 1) {
      sim.call("registerNotary", ps(), pks[i], BigInt(i));
    }
    expect(() =>
      sim.call(
        "verifyAttestation",
        ps({
          assertion: attestation.assertion,
          signatures: attestation.signatures,
          commitRand: randomBytes(32),
          holderSecret,
        }),
      ),
    ).not.toThrow();
  });

  it("degrades to 2-of-3 when one instance is down", async () => {
    const client = new NotaryClient([urls[0], urls[1], "http://127.0.0.1:1"]);
    const attestation = await client.attestate(fixture);
    expect(attestation.notaryIds).toEqual(["test-notary-1", "test-notary-2", ""]);
    expect(attestation.signatures[2]).toEqual({ announcement: { x: 0n, y: 1n }, response: 0n });
  });

  it("rejects fewer than 2 responses", async () => {
    const client = new NotaryClient([urls[0], "http://127.0.0.1:1"]);
    await expect(client.attestate(fixture)).rejects.toThrow(/fewer than 2 notaries/);
  });

  it("rejects inconsistent assertions across instances", async () => {
    const rogue = await startNotary(2);
    const rogueUrl = rogue.url;
    const client = new NotaryClient([urls[0], rogueUrl]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      if (String(input).startsWith(rogueUrl)) {
        return originalFetch(input, init).then(async (res) => {
          const body = (await res.json()) as Record<string, unknown>;
          const assertion = body.assertion as Record<string, unknown>;
          body.assertion = {
            ...assertion,
            timestamp: "0x" + (BigInt(assertion.timestamp as string) + 1n).toString(16),
          };
          return new Response(JSON.stringify(body), { status: 200 });
        });
      }
      return originalFetch(input, init);
    };
    try {
      await expect(client.attestate(fixture)).rejects.toThrow(/different assertions/);
    } finally {
      globalThis.fetch = originalFetch;
      await new Promise<void>((resolve) => rogue.server.close(resolve));
    }
  });

  it("maps signatures to registry slots by URL order, not completion order (regression)", async () => {
    // Reverse the completion order: urls[2] answers first, urls[0] last.
    // The pre-fix code assigned signatures by completion order, so slot 0 got
    // notary-3's signature and the circuit rejected everything with
    // "Insufficient valid signatures" (registry slot i == urls[i]).
    const client = new NotaryClient(urls);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = String(input);
      const delay = url.startsWith(urls[0]) ? 200 : url.startsWith(urls[1]) ? 100 : 0;
      return new Promise((resolve) => setTimeout(() => resolve(originalFetch(input, init)), delay));
    };
    try {
      const attestation = await client.attestate(fixture);
      expect(attestation.notaryIds).toEqual(["test-notary-1", "test-notary-2", "test-notary-3"]);
      const sim = new StrideSim(ps());
      sim.call("registerAdmin", ps());
      for (let i = 0; i < 3; i += 1) {
        sim.call("registerNotary", ps(), pks[i], BigInt(i));
      }
      expect(() =>
        sim.call(
          "verifyAttestation",
          ps({
            assertion: attestation.assertion,
            signatures: attestation.signatures,
            commitRand: randomBytes(32),
            holderSecret,
          }),
        ),
      ).not.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

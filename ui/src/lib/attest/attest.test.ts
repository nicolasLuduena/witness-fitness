// Round 1C browser attestation module tests: OAuth URL/callback parsing,
// token persistence + auto-refresh, service exchange/refresh shapes, the
// attestStrava artifact contract (vs the notary's normalizeArtifacts), the
// empty-account guard, and a REAL stwo chacha20 prove/verify roundtrip
// through the vendored wasm (proves the browser operator port is faithful).
//
// Runs in vitest's node env: attestor-core is mocked (its browser-bundle
// wiring is a Round-2 build concern), the service + Strava APIs are stubbed
// via globalThis.fetch, localStorage is an in-memory shim.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Cross-package check: the notary's REAL artifact normalizer (pure module;
// its attestor-core import is satisfied by the mock below).
import { normalizeArtifacts } from "../../../../packages/notary/src/verify-reclaim.ts";

// node:fs/node:url are intercepted by vite-plugin-node-polyfills in vitest
// (node-stdlib-browser's punycode proxy breaks); the REAL node builtins are
// reachable through process.getBuiltinModule (kept intact by the polyfill's
// `||` guard). Read the vendored wasm this way for the real-crypto test.
const readFileSync = (
  process as unknown as { getBuiltinModule(name: string): typeof import("node:fs") }
).getBuiltinModule("node:fs").readFileSync;

const fetchMock = vi.fn();
const createClaimOnAttestorMock = vi.fn();
const assertValidClaimSignaturesMock = vi.fn();

vi.mock("@reclaimprotocol/attestor-core", () => ({
  createClaimOnAttestor: (...args: unknown[]) => createClaimOnAttestorMock(...args),
  assertValidClaimSignatures: (...args: unknown[]) => assertValidClaimSignaturesMock(...args),
}));

import {
  attestStrava,
  fetchAuthRequest,
  getOrCreateOwnerKey,
  proofToNotaryArtifacts,
  transformProof,
  type AttestResult,
} from "./attest-browser";
import {
  buildAuthUrl,
  emptyAccountGuard,
  exchangeCode,
  fetchActivities,
  getValidAccessToken,
  localStorageTokenStore,
  parseAuthCallback,
  refreshAccessToken,
  shouldRefresh,
  type StoredTokens,
} from "./strava";
import { athleteIdentityFromExchange } from "./identity";
import { initStwoFromBytes, makeStwoZkOperator } from "./stwo-browser";

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }) as Response;

const storage = new Map<string, string>();

beforeEach(() => {
  fetchMock.mockReset();
  createClaimOnAttestorMock.mockReset();
  assertValidClaimSignaturesMock.mockReset();
  storage.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  };
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  fetchMock.mockImplementation(async () => jsonResponse({}, 404));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("oauth url + callback", () => {
  it("builds the authorize URL with client id, redirect uri and scopes", () => {
    const url = buildAuthUrl({
      clientId: "270524",
      redirectUri: "http://localhost:5173/strava/callback",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("270524");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:5173/strava/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("read,activity:read_all");
  });

  it("parses the code out of a callback URL", () => {
    const cb = parseAuthCallback("http://localhost:5173/strava/callback?code=abc123&scope=read");
    expect(cb.code).toBe("abc123");
    expect(cb.error).toBeUndefined();
  });

  it("parses a denied callback", () => {
    const cb = parseAuthCallback("http://localhost:5173/strava/callback?error=access_denied");
    expect(cb.error).toBe("access_denied");
    expect(cb.code).toBeUndefined();
  });
});

describe("token persistence + auto-refresh decision", () => {
  const tokens: StoredTokens = {
    access_token: "acc-1",
    refresh_token: "ref-1",
    expires_at: 0,
    athlete: { id: 1390331368, firstname: "Nicolás", lastname: "Ludueña" },
  };

  it("round-trips tokens through the localStorage store", () => {
    localStorageTokenStore.save(tokens);
    const loaded = localStorageTokenStore.load();
    expect(loaded).toEqual(tokens);
    localStorageTokenStore.clear();
    expect(localStorageTokenStore.load()).toBeNull();
  });

  it("refuses to load malformed stored tokens", () => {
    storage.set("wf-strava-tokens", JSON.stringify({ access_token: "only" }));
    expect(localStorageTokenStore.load()).toBeNull();
  });

  it("decides to refresh only when expiry is within the 60s slack", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00Z"));
    const nowS = Math.floor(Date.now() / 1000);
    expect(shouldRefresh({ ...tokens, expires_at: nowS + 61 })).toBe(false);
    expect(shouldRefresh({ ...tokens, expires_at: nowS + 60 })).toBe(true);
    expect(shouldRefresh({ ...tokens, expires_at: nowS - 10 })).toBe(true);
  });

  it("reuses a valid token without touching the service", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00Z"));
    localStorageTokenStore.save({ ...tokens, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    const token = await getValidAccessToken();
    expect(token).toBe("acc-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auto-refreshes near expiry via the service and persists the new pair", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00Z"));
    localStorageTokenStore.save({ ...tokens, expires_at: Math.floor(Date.now() / 1000) + 30 });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: "acc-2", refresh_token: "ref-2", expires_at: 9999999999 }),
    );
    const token = await getValidAccessToken();
    expect(token).toBe("acc-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8200/strava/refresh");
    expect(JSON.parse(String(init.body))).toEqual({ refresh_token: "ref-1" });
    const persisted = localStorageTokenStore.load();
    expect(persisted?.access_token).toBe("acc-2");
    expect(persisted?.refresh_token).toBe("ref-2");
    // athlete survives the refresh (identity continuity)
    expect(persisted?.athlete?.id).toBe(1390331368);
  });

  it("fails fast when no tokens are stored", async () => {
    await expect(getValidAccessToken()).rejects.toThrow("no strava tokens stored");
  });
});

describe("service exchange/refresh", () => {
  it("exchanges a code with ONLY the code in the request body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        access_token: "acc-x",
        refresh_token: "ref-x",
        expires_at: 123,
        athlete: { id: 42, firstname: "Ada", lastname: "Lovelace" },
      }),
    );
    const result = await exchangeCode("the-code");
    expect(result.access_token).toBe("acc-x");
    expect(result.athlete.firstname).toBe("Ada");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8200/strava/exchange");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({ code: "the-code" });
    expect(Object.keys(body)).not.toContain("client_secret");
  });

  it("surfaces the service error shape on 400", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid code" }, 400));
    await expect(exchangeCode("bad")).rejects.toThrow("invalid code");
  });

  it("refreshes with only the refresh token in the request body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: "acc-y", refresh_token: "ref-y", expires_at: 456 }),
    );
    const result = await refreshAccessToken("ref-old");
    expect(result.access_token).toBe("acc-y");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8200/strava/refresh");
    expect(JSON.parse(String(init.body))).toEqual({ refresh_token: "ref-old" });
  });
});

describe("attestStrava artifact contract (notary ProofArtifacts shape)", () => {
  const address = "0x1234567890abcdef1234567890abcdef12345678";
  const claimSignature = new Uint8Array(65).fill(7);

  const claimTunnelResponse = {
    request: undefined,
    claim: {
      provider: "http",
      parameters: '{"url":"https://www.strava.com/api/v3/athlete/activities?per_page=5"}',
      owner: "0xowner",
      timestampS: 1783333333,
      context: '{"extractedParameters":{"data":"HTTP/1.1 200 OK\\r\\n\\r\\n[]"}}',
      identifier: "0x96210cee",
      epoch: 0,
    },
    signatures: {
      claimSignature,
      attestorAddress: address,
      resultSignature: new Uint8Array(65),
    },
  };

  it("fetches the auth request from the service and drives createClaimOnAttestor", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        authRequest: {
          id: "witnessfitness-demo",
          hostWhitelist: ["www.strava.com"],
          signature: "0x" + "ab".repeat(65),
          signer: "attestor-1",
        },
      }),
    );
    createClaimOnAttestorMock.mockResolvedValue(claimTunnelResponse);

    const result = await attestStrava("bearer-token");
    expect(result.proof.claimData.identifier).toBe("0x96210cee");

    // auth-request fetch: POST, no body, no private key anywhere
    const [authUrl, authInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(authUrl).toBe("http://127.0.0.1:8200/attestor-auth-request");
    expect(authInit.method).toBe("POST");

    const call = createClaimOnAttestorMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.name).toBe("http");
    expect((call.params as Record<string, unknown>).url).toBe(
      "https://www.strava.com/api/v3/athlete/activities?per_page=5",
    );
    expect(
      (call.secretParams as Record<string, Record<string, string>>).headers.authorization,
    ).toBe("Bearer bearer-token");
    expect(call.zkEngine).toBe("stwo");
    expect(Object.keys(call.zkOperators as Record<string, unknown>).sort()).toEqual([
      "aes-128-ctr",
      "aes-256-ctr",
      "chacha20",
    ]);
    const client = call.client as {
      url: string;
      authRequest: { data: { id: string; hostWhitelist: string[] }; signature: Uint8Array };
    };
    expect(client.url).toBe("ws://localhost:8001/ws");
    expect(client.authRequest.data.id).toBe("witnessfitness-demo");
    expect(client.authRequest.data.hostWhitelist).toEqual(["www.strava.com"]);
    expect(client.authRequest.signature).toBeInstanceOf(Uint8Array);
    expect(client.authRequest.signature.length).toBe(65);
    expect(call.ownerPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("produces the transformProof shape the notary accepts", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        authRequest: { id: "x", hostWhitelist: ["www.strava.com"], signature: "aa".repeat(65) },
      }),
    );
    createClaimOnAttestorMock.mockResolvedValue(claimTunnelResponse);
    const result = await attestStrava("t");

    // the client's transformProof contract: claimData + signatures[] + witnesses[]
    expect(result.claim.claim?.identifier).toBe("0x96210cee");
    expect(result.proof.claimData.identifier).toBe("0x96210cee");
    expect(result.proof.identifier).toBe("0x96210cee");
    expect(result.proof.signatures).toEqual(["0x" + "07".repeat(65)]);
    expect(result.proof.extractedParameterValues).toEqual({ data: expect.any(String) });
    expect(result.proof.witnesses).toHaveLength(1);
    expect(result.proof.witnesses[0].url).toBe("ws://localhost:8001/ws");
    // witnesses[0].id is the UTF-8 hex of the address string (client parity)
    expect(result.proof.witnesses[0].id).toBe("0x" + Buffer.from(address).toString("hex"));

    // the notary's REAL normalizer accepts the transformProof shape and
    // recovers the fields (proofArtifacts = the transformProof output)
    const normalized = normalizeArtifacts(result.proof);
    expect(normalized.claim.identifier).toBe("0x96210cee");
    expect(normalized.signatureHex).toBe("0x" + "07".repeat(65));
    expect(normalized.attestorAddress).toBe(address);
  });

  it("verifies claim signatures through the attestor-core SDK", async () => {
    assertValidClaimSignaturesMock.mockResolvedValue(undefined);
    await expect(
      import("./attest-browser").then((m) => m.verifyClaimSignatures(claimTunnelResponse)),
    ).resolves.toBeUndefined();
    expect(assertValidClaimSignaturesMock).toHaveBeenCalledWith(claimTunnelResponse);
  });

  it("maps onto the notary ProofArtifacts shape (claimSignatureHex alias)", async () => {
    const result: AttestResult = {
      claim: claimTunnelResponse,
      proof: {
        claimData: claimTunnelResponse.claim,
        identifier: "0x96210cee",
        signatures: ["0x" + "07".repeat(65)],
        extractedParameterValues: { data: "HTTP/1.1 200 OK\r\n\r\n[]" },
        witnesses: [
          { id: "0x" + Buffer.from(address).toString("hex"), url: "ws://localhost:8001/ws" },
        ],
      },
    };
    const artifacts = proofToNotaryArtifacts(result);
    expect(artifacts.claimSignatureHex).toBe("0x" + "07".repeat(65));
    expect(artifacts.attestorAddress).toBe(address);
    expect(artifacts.responseText).toContain("HTTP/1.1 200 OK");
    // normalizeArtifacts accepts the claimSignatureHex alias verbatim
    const normalized = normalizeArtifacts(artifacts);
    expect(normalized.signatureHex).toBe(artifacts.claimSignatureHex);
    expect(normalized.attestorAddress).toBe(address);
  });

  it("fills auth-request timestamps only when the service omits them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00Z"));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ authRequest: { id: "y", hostWhitelist: [], signature: "bb".repeat(65) } }),
    );
    const authRequest = await fetchAuthRequest();
    const expectedNowS = Math.floor(new Date("2026-08-07T12:00:00Z").getTime() / 1000);
    expect(authRequest.data.createdAt).toBe(expectedNowS);
    expect(authRequest.data.expiresAt).toBe(expectedNowS + 900);
  });

  it("passes service-provided auth data through verbatim", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        authRequest: {
          data: { id: "z", hostWhitelist: ["www.strava.com"], createdAt: 1, expiresAt: 2 },
          signature: "cc".repeat(65),
        },
      }),
    );
    const authRequest = await fetchAuthRequest();
    expect(authRequest.data).toEqual({
      id: "z",
      hostWhitelist: ["www.strava.com"],
      createdAt: 1,
      expiresAt: 2,
    });
  });

  it("persists a 0x-prefixed per-origin owner key (ethers v6 requires BytesLike)", () => {
    const key = getOrCreateOwnerKey();
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    expect(getOrCreateOwnerKey()).toBe(key);
  });

  it("normalizes legacy unprefixed stored owner keys", () => {
    localStorage.setItem("wf-attest-owner-key", "ab".repeat(32));
    const key = getOrCreateOwnerKey();
    expect(key).toBe("0x" + "ab".repeat(32));
    expect(localStorage.getItem("wf-attest-owner-key")).toBe("0x" + "ab".repeat(32));
  });
});

describe("transformProof parity with the node client", () => {
  it("rejects claims without data or signatures", () => {
    expect(() =>
      transformProof({ request: undefined, claim: undefined, signatures: undefined }, "ws://x"),
    ).toThrow("claim missing data or signatures");
  });
});

describe("empty-account guard", () => {
  it("blocks interaction when the athlete has zero activities", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const verdict = await emptyAccountGuard("tok");
    expect(verdict.canInteract).toBe(false);
    if (!verdict.canInteract) {
      expect(verdict.reason).toBe("no-activities");
    }
  });

  it("allows interaction with activities present", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: 1, distance: 3900.3, moving_time: 2942, start_date: "2026-07-02T23:00:06Z" },
      ]),
    );
    const verdict = await emptyAccountGuard("tok");
    expect(verdict.canInteract).toBe(true);
    if (verdict.canInteract) {
      expect(verdict.activities[0].distance).toBe(3900.3);
    }
  });

  it("fetchActivities hits the strava API with a bearer token (CORS verified)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await fetchActivities("tok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.strava.com/api/v3/athlete/activities?per_page=5");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});

describe("identity", () => {
  it("derives the dynamic athlete username from the exchange", () => {
    const identity = athleteIdentityFromExchange({
      access_token: "a",
      refresh_token: "r",
      expires_at: 1,
      athlete: { id: 1390331368, firstname: "Nicolás", lastname: "Ludueña" },
    });
    expect(identity).toEqual({ name: "Nicolás Ludueña", stravaId: 1390331368 });
  });
});

describe("browser stwo operator (real wasm roundtrip)", () => {
  beforeAll(() => {
    // decodeURIComponent(new URL(...).pathname) → filesystem path (Linux)
    const wasmPath = decodeURIComponent(
      new URL("./vendor/s2circuits_bg.wasm", import.meta.url).pathname,
    );
    initStwoFromBytes(new Uint8Array(readFileSync(wasmPath)));
  });

  // Build a witness exactly like the real flow (zk-symmetric-crypto's
  // generateZkWitness over a genuine chacha20-poly1305 AEAD record).
  const makeWitness = async () => {
    const { CONFIG, generateZkWitness } = await import("@reclaimprotocol/zk-symmetric-crypto");
    const key = new Uint8Array(32).fill(0x11);
    const iv = new Uint8Array(12).fill(0x22);
    const plaintext = new Uint8Array(64).fill(0x33);
    // CONFIG.chacha20.encrypt returns the tag-stripped ciphertext as raw bytes
    const ciphertext = await CONFIG.chacha20.encrypt({ key, iv, in: plaintext });
    const { witness } = await generateZkWitness({
      algorithm: "chacha20",
      privateInput: { key },
      publicInput: { ciphertext, iv },
    });
    return witness;
  };

  it("proves and verifies a chacha20 chunk through the operator interface", async () => {
    const operator = makeStwoZkOperator({ algorithm: "chacha20" });
    const witness = await makeWitness();
    const serialized = await operator.generateWitness(witness);
    expect(serialized).toBeInstanceOf(Uint8Array);
    const { proof } = await operator.groth16Prove(serialized);
    expect(proof).toBeInstanceOf(Uint8Array);
    expect(proof.length).toBeGreaterThan(0);
    const valid = await operator.groth16Verify(
      {
        noncesAndCounters: witness.noncesAndCounters,
        in: witness.in,
        out: witness.out,
      },
      proof,
    );
    expect(valid).toBe(true);
  });

  it("rejects verification against tampered public inputs", async () => {
    const operator = makeStwoZkOperator({ algorithm: "chacha20" });
    const witness = await makeWitness();
    const serialized = await operator.generateWitness(witness);
    const { proof } = await operator.groth16Prove(serialized);
    const tampered = witness.out.slice();
    tampered[0] ^= 0xff;
    const valid = await operator.groth16Verify(
      {
        noncesAndCounters: witness.noncesAndCounters,
        in: witness.in,
        out: tampered,
      },
      proof,
    );
    expect(valid).toBe(false);
  });
});

describe("re2 browser shim (attestor-core makeRegex path)", () => {
  it("default export is callable without new and returns a native RegExp", async () => {
    const mod = await import("./stubs/re2.js");
    const RE2 = mod.default as (pattern: string, flags?: string) => RegExp;
    expect(typeof RE2).toBe("function");
    const re = RE2("(?<data>.*)", "sgiu");
    expect(re).toBeInstanceOf(RegExp);
    expect("abc".match(re)).not.toBeNull();
  });

  it("supports new (hypothetical constructor-style call)", async () => {
    const mod = await import("./stubs/re2.js");
    const re = Reflect.construct(
      mod.default as unknown as new (
        pattern: string,
        flags?: string,
      ) => RegExp,
      ["x", "i"],
    );
    expect(re).toBeInstanceOf(RegExp);
  });
});

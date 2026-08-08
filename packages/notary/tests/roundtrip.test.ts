// THE PARITY GATE (ARCHITECTURE.md §4, NOTARY.md §3, DoD §7): a fixture proof
// → verify-reclaim → assert → sign with the notary signer → ACCEPTED in the
// contract simulator. Tampered → rejected. Nothing downstream proceeds until
// this passes. Mirrors packages/contract/tests/parity-roundtrip.test.ts but
// drives the pipeline with the notary's own modules.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createPrivateState,
  type PrivateState,
  type SchnorrSignature,
} from "@witnessfitness/contract";
import { StrideSim } from "./helpers/sim.js";
import { verifyReclaimProof, type ProofArtifacts } from "../src/verify-reclaim.js";
import { buildAssertion } from "../src/assert.js";
import { publicKeyOf, signAssertion } from "../src/sign.js";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "client",
  "fixtures",
);
const ALLOWED = ["api.github.com", "strava.com"];

const fixture = (name: string): ProofArtifacts =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8"));

// The 3 demo instance keys (separated in production; same shape here).
const NOTARY_SKS = [0x11111111n, 0x22222222n, 0x33333333n];

const adminSecret = randomBytes(32);
const holderSecret = randomBytes(32);
const ps = (overrides: Partial<PrivateState> = {}): PrivateState => ({
  ...createPrivateState(adminSecret, holderSecret),
  ...overrides,
});

const register = (sim: StrideSim): void => {
  sim.call("registerAdmin", ps());
  for (let i = 0; i < 3; i += 1) {
    sim.call("registerNotary", ps(), signPublicKey(i), BigInt(i));
  }
};

const signPublicKey = (i: number): { x: bigint; y: bigint } => publicKeyOf(NOTARY_SKS[i]);

const dummySig = (): SchnorrSignature => ({ announcement: { x: 0n, y: 1n }, response: 0n });

const attestationFor = async (
  fixtureName: string,
  keys: (number | null)[],
): Promise<PrivateState> => {
  const artifacts = fixture(fixtureName);
  const verified = await verifyReclaimProof(artifacts, ALLOWED);
  const { assertion } = buildAssertion(verified);
  const signatures = keys.map((k) =>
    k === null ? dummySig() : signAssertion(NOTARY_SKS[k], assertion),
  );
  return ps({
    assertion,
    signatures,
    commitRand: randomBytes(32),
    holderSecret,
  });
};

describe("signature parity roundtrip (notary pipeline → simulator)", () => {
  it("accepts a notary-signed fixture assertion (3-of-3 and every 2-of-3 pair)", async () => {
    for (const fixtureName of [
      "fixture-github-attestor-core-x-0m.json",
      "fixture-github-attestor-core-fresh-x-84m.json",
    ]) {
      for (const keySet of [
        [0, 1, 2],
        [0, 1, null],
        [0, null, 2],
        [null, 1, 2],
      ]) {
        const sim = new StrideSim(ps());
        register(sim);
        const state = await attestationFor(fixtureName, keySet as (number | null)[]);
        expect(() => sim.call("verifyAttestation", state)).not.toThrow();
      }
    }
  });

  it("rejects 1-of-3", async () => {
    const sim = new StrideSim(ps());
    register(sim);
    const state = await attestationFor("fixture-github-attestor-core-fresh-x-84m.json", [
      0,
      null,
      null,
    ]);
    expect(() => sim.call("verifyAttestation", state)).toThrow("Insufficient valid signatures");
  });

  it("rejects a tampered assertion (flipped claim value after signing)", async () => {
    const sim = new StrideSim(ps());
    register(sim);
    const artifacts = fixture("fixture-github-attestor-core-x-0m.json");
    const verified = await verifyReclaimProof(artifacts, ALLOWED);
    const { assertion } = buildAssertion(verified);
    const signatures = [
      signAssertion(NOTARY_SKS[0], assertion),
      signAssertion(NOTARY_SKS[1], assertion),
      dummySig(),
    ];
    const tampered = {
      ...assertion,
      claims: assertion.claims.map((c, i) => (i === 0 ? { ...c, value: c.value + 1n } : c)),
    };
    expect(() =>
      sim.call("verifyAttestation", ps({ assertion: tampered, signatures, holderSecret })),
    ).toThrow("Insufficient valid signatures");
  });

  it("rejects a signature from an unregistered key", async () => {
    const sim = new StrideSim(ps());
    register(sim);
    const artifacts = fixture("fixture-github-attestor-core-x-0m.json");
    const verified = await verifyReclaimProof(artifacts, ALLOWED);
    const { assertion } = buildAssertion(verified);
    const outsider = 0xdeadbeefn;
    const signatures = [
      signAssertion(outsider, assertion),
      signAssertion(outsider, assertion),
      dummySig(),
    ];
    expect(() =>
      sim.call("verifyAttestation", ps({ assertion, signatures, holderSecret })),
    ).toThrow("Insufficient valid signatures");
  });

  it("vaults the credential (ledger learns commitment, holder binding, timestamp)", async () => {
    const sim = new StrideSim(ps());
    register(sim);
    const state = await attestationFor("fixture-github-attestor-core-x-0m.json", [0, 1, null]);
    sim.call("verifyAttestation", state);
    const view = sim.ledgerView();
    const { pureCircuits } = await import("@witnessfitness/contract");
    const vaultKey = pureCircuits.computeVaultKey(state.assertion!, state.commitRand);
    expect(view.vault.member(vaultKey)).toBe(true);
    expect(view.vault.lookup(vaultKey).timestamp).toBe(state.assertion!.timestamp);
  });

  it("rejects replay of the same nonce", async () => {
    const sim = new StrideSim(ps());
    register(sim);
    const state = await attestationFor("fixture-github-attestor-core-fresh-x-84m.json", [
      0,
      1,
      null,
    ]);
    sim.call("verifyAttestation", state);
    expect(() => sim.call("verifyAttestation", state)).toThrow("Nonce replay");
  });
});

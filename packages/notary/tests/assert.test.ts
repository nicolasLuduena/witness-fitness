// NOTARY.md §6.2 — assert builds schema-valid assertions on the contract's
// compiled A_Assertion type, and deterministically so: all three notary
// instances must sign the IDENTICAL assertion for the 2-of-3 threshold to
// work on-chain.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { encodeAssertion, type A_Assertion } from "@witnessfitness/contract";
import { verifyReclaimProof, type ProofArtifacts } from "../src/verify-reclaim.js";
import { buildAssertion, METRIC_DISTANCE } from "../src/assert.js";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "client",
  "fixtures",
);
const ALLOWED = ["api.github.com", "strava.com"];

const loadFixture = (name: string): ProofArtifacts =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8"));

describe("assert", () => {
  it("builds a schema-valid assertion from a verified fixture", async () => {
    const artifacts = loadFixture("fixture-github-attestor-core-x-0m.json");
    const verified = await verifyReclaimProof(artifacts, ALLOWED);
    const { assertion } = buildAssertion(verified);

    expect(assertion.version).toBe(1n);
    expect(assertion.provider).toBe(1n);
    expect(assertion.claims).toHaveLength(8);
    expect(assertion.claimCount).toBeGreaterThan(0n);
    expect(assertion.claimCount).toBeLessThanOrEqual(8n);
    expect(assertion.timestamp).toBe(BigInt(artifacts.claim.timestampS));
    expect(assertion.nonce).toHaveLength(32);
    expect(assertion.reclaimProofHash).toHaveLength(32);
    expect(assertion.claims[0].metricId).toBe(METRIC_DISTANCE);
    expect(() => encodeAssertion(assertion)).not.toThrow();
  });

  it("is deterministic per artifact (the 2-of-3 same-assertion property)", async () => {
    const artifacts = loadFixture("fixture-github-attestor-core-fresh-x-84m.json");
    const verified = await verifyReclaimProof(artifacts, ALLOWED);
    const { assertion: a } = buildAssertion(verified);
    const { assertion: b } = buildAssertion(verified);
    expect(a).toEqual(b);
    expect(encodeAssertion(a)).toEqual(encodeAssertion(b));
  });

  it("produces distinct assertions for distinct artifacts", async () => {
    const gh = await verifyReclaimProof(
      loadFixture("fixture-github-attestor-core-x-0m.json"),
      ALLOWED,
    );
    const cg = await verifyReclaimProof(
      loadFixture("fixture-github-attestor-core-fresh-x-84m.json"),
      ALLOWED,
    );
    const { assertion: fromGh } = buildAssertion(gh);
    const { assertion: fromCg } = buildAssertion(cg);
    expect(Buffer.from(fromGh.nonce).equals(Buffer.from(fromCg.nonce))).toBe(false);
    expect(encodeAssertion(fromGh)).not.toEqual(encodeAssertion(fromCg));
  });

  it("pads claims to 8 and carries the real claimCount", async () => {
    const artifacts = loadFixture("fixture-github-attestor-core-fresh-x-84m.json");
    const verified = await verifyReclaimProof(artifacts, ALLOWED);
    const { assertion } = buildAssertion(verified);
    const active = (assertion as A_Assertion).claims.slice(
      0,
      Number((assertion as A_Assertion).claimCount),
    );
    expect(active.every((c) => c.metricId !== 0n)).toBe(true);
    const padding = (assertion as A_Assertion).claims.slice(
      Number((assertion as A_Assertion).claimCount),
    );
    expect(padding.every((c) => c.metricId === 0n && c.value === 0n)).toBe(true);
  });
});

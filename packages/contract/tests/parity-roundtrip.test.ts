// SIGNATURE PARITY ROUNDTRIP (ARCHITECTURE.md §4, CONTRACT.md §7.11).
// This is the hard gate for the notary workstream: an assertion signed
// OFF-CHAIN (exactly as the notary signer will) must verify IN-CIRCUIT on the
// simulator. Run standalone:
//   pnpm --filter @witnessfitness/contract test -- parity-roundtrip
// The notary workspace must use the same path: pureCircuits.encodeAssertion
// + pureCircuits.schnorrChallenge from @witnessfitness/contract, truncate the
// challenge mod 2^248, compute s = (k + c*sk) mod JUBJUB_ORDER (JUBJUB_ORDER
// exported from the contract package), and submit (R = k*G, s) as
// { announcement: {x, y}, response }.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StrideSim } from "./helpers/sim.js";
import { makeAssertion, makeNotaryKey, privateStateWith } from "./helpers/fixtures.js";
import { createPrivateState } from "../src/private-state.js";
import { JUBJUB_ORDER, derivePublicKey, signAssertion } from "../src/offchain.js";

const adminSecret = randomBytes(32);
const holderSecret = randomBytes(32);
const notaryKeys = [makeNotaryKey(1), makeNotaryKey(2), makeNotaryKey(3)];

const ps = (overrides = {}) => ({ ...createPrivateState(adminSecret, holderSecret), ...overrides });

const register = (sim: StrideSim) => {
  sim.call("registerAdmin", ps());
  for (let i = 0; i < 3; i += 1) {
    sim.call("registerNotary", ps(), notaryKeys[i].pk, BigInt(i));
  }
};

describe("signature parity roundtrip", () => {
  it("accepts an off-chain signed assertion (2-of-3 and 3-of-3)", () => {
    const sim = new StrideSim(ps());
    register(sim);

    const twoOfThree = makeAssertion();
    const att2 = {
      assertion: twoOfThree,
      signatures: [
        signAssertion(notaryKeys[0].sk, twoOfThree, twoOfThree.nonce),
        signAssertion(notaryKeys[1].sk, twoOfThree, twoOfThree.nonce),
        { announcement: { x: 0n, y: 1n }, response: 0n },
      ],
      commitRand: randomBytes(32),
      holderSecret,
    };
    expect(() => sim.call("verifyAttestation", privateStateWith(ps(), att2))).not.toThrow();

    const threeOfThree = makeAssertion();
    const att3 = {
      assertion: threeOfThree,
      signatures: notaryKeys.map((k) => signAssertion(k.sk, threeOfThree, threeOfThree.nonce)),
      commitRand: randomBytes(32),
      holderSecret,
    };
    expect(() => sim.call("verifyAttestation", privateStateWith(ps(), att3))).not.toThrow();
  });

  it("rejects a tampered assertion (flipped claim value)", () => {
    const sim = new StrideSim(ps());
    register(sim);

    const original = makeAssertion({ claims: [{ metricId: 1n, value: 12345n }] });
    const signed = privateStateWith(ps(), {
      assertion: original,
      signatures: [
        signAssertion(notaryKeys[0].sk, original, original.nonce),
        signAssertion(notaryKeys[1].sk, original, original.nonce),
        { announcement: { x: 0n, y: 1n }, response: 0n },
      ],
      commitRand: randomBytes(32),
      holderSecret,
    });
    signed.assertion = {
      ...original,
      claims: original.claims.map((c, i) => (i === 0 ? { ...c, value: 54321n } : c)),
    };
    expect(() => sim.call("verifyAttestation", signed)).toThrow("Insufficient valid signatures");
  });

  it("rejects a signature from an unregistered key", () => {
    const sim = new StrideSim(ps());
    register(sim);

    const outsider = makeNotaryKey(99);
    const assertion = makeAssertion();
    const bad = {
      assertion,
      signatures: [
        signAssertion(outsider.sk, assertion, assertion.nonce),
        signAssertion(outsider.sk, assertion, assertion.nonce),
        { announcement: { x: 0n, y: 1n }, response: 0n },
      ],
      commitRand: randomBytes(32),
      holderSecret,
    };
    expect(() => sim.call("verifyAttestation", privateStateWith(ps(), bad))).toThrow(
      "Insufficient valid signatures",
    );
  });

  it("exposes the exact JUBJUB_ORDER used for response reduction", () => {
    expect(JUBJUB_ORDER).toBe(0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n);
    expect(derivePublicKey(1n)).toBeDefined();
  });
});

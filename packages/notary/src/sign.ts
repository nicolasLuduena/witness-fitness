// Jubjub-Schnorr signing with exact circuit parity (ARCHITECTURE.md §4,
// packages/contract/README.md "Notary parity contract"). k is a fresh CSPRNG
// scalar per signature — the contract exports' deriveNonce is a deterministic
// fixture helper only.
import { randomBytes } from "node:crypto";
import { ecMulGenerator } from "@midnight-ntwrk/compact-runtime";
import {
  type A_Assertion,
  derivePublicKey,
  encodeAssertion,
  JUBJUB_ORDER,
  type SchnorrSignature,
  schnorrChallenge,
} from "@witnessfitness/contract";

const TWO_248 = 1n << 248n;

export const randomNonce = (): bigint => {
  for (;;) {
    const candidate = BigInt("0x" + randomBytes(32).toString("hex")) % (JUBJUB_ORDER - 1n);
    if (candidate > 0n) {
      return candidate;
    }
  }
};

export const signAssertion = (sk: bigint, assertion: A_Assertion): SchnorrSignature => {
  const pk = derivePublicKey(sk);
  const msg = encodeAssertion(assertion);
  const k = randomNonce();
  const announcement = ecMulGenerator(k);
  const cFull = schnorrChallenge(announcement, pk, msg);
  const c = cFull % TWO_248;
  const response = (k + c * sk) % JUBJUB_ORDER;
  return { announcement, response };
};

export const publicKeyOf = (sk: bigint): { x: bigint; y: bigint } => derivePublicKey(sk);

// Reduce an arbitrary hex secret to a valid nonzero Jubjub scalar. The
// runtime's ecMulGenerator rejects scalars >= JUBJUB_ORDER.
export const secretKeyFromHex = (hex: string): bigint => {
  const scalar = BigInt("0x" + hex.replace(/^0x/, ""));
  return (scalar % (JUBJUB_ORDER - 1n)) + 1n;
};

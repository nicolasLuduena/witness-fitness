import { randomBytes } from 'node:crypto';
import { pureCircuits } from '../../src/managed/stride/contract/index.js';
import type { A_Assertion } from '../../src/managed/stride/contract/index.js';
import { derivePublicKey, signAssertion, type SchnorrSignature } from '../../src/offchain.js';
import type { PrivateState } from '../../src/private-state.js';

export const nowSeconds = (): bigint => BigInt(Math.floor(Date.now() / 1000));

export const makeAssertion = (
  overrides: Partial<A_Assertion> & { claims?: { metricId: bigint; value: bigint }[] } = {}
): A_Assertion => {
  const claims = overrides.claims ?? [{ metricId: 1n, value: 12345n }];
  const padded: A_Assertion['claims'] = [];
  for (let i = 0; i < 8; i += 1) {
    padded.push(claims[i] ?? { metricId: 0n, value: 0n });
  }
  return {
    version: 1n,
    provider: 1n,
    claimCount: BigInt(claims.length),
    timestamp: nowSeconds(),
    nonce: randomBytes(32),
    reclaimProofHash: randomBytes(32),
    ...overrides,
    claims: padded,
  };
};

export const vaultKeyOf = (assertion: A_Assertion, rand: Uint8Array): Uint8Array =>
  pureCircuits.computeVaultKey(assertion, rand);

export const holderBindingOf = (secret: Uint8Array): bigint =>
  pureCircuits.holderBinding(secret);

export type NotaryKey = {
  sk: bigint;
  pk: { x: bigint; y: bigint };
};

export const makeNotaryKey = (seed: number): NotaryKey => {
  const sk = BigInt('0x' + Buffer.from(randomBytes(31)).toString('hex')) % (1n << 248n);
  return { sk, pk: derivePublicKey(sk) };
};

export type SignedAttestation = {
  assertion: A_Assertion;
  signatures: SchnorrSignature[];
  commitRand: Uint8Array;
  holderSecret: Uint8Array;
};

// Sign an assertion with the given notary keys. Empty slots get dummy sigs
// (identity announcement, zero response — never verified).
export const signAttestation = (
  assertion: A_Assertion,
  keys: (NotaryKey | null)[],
  holderSecret: Uint8Array,
  commitRand: Uint8Array
): SignedAttestation => {
  const signatures: SchnorrSignature[] = [];
  for (let i = 0; i < 3; i += 1) {
    const key = keys[i];
    signatures.push(
      key === null
        ? { announcement: { x: 0n, y: 1n }, response: 0n }
        : signAssertion(key.sk, assertion, assertion.nonce)
    );
  }
  return { assertion, signatures, commitRand, holderSecret };
};

export const randomField = (): bigint => BigInt('0x' + randomBytes(31).toString('hex'));

export const privateStateWith = (
  base: PrivateState,
  att: SignedAttestation
): PrivateState => ({
  ...base,
  assertion: att.assertion,
  signatures: att.signatures,
  commitRand: att.commitRand,
  holderSecret: att.holderSecret,
});

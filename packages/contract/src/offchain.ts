// Off-chain Jubjub-Schnorr signing for WitnessFitness assertions.
// THIS IS THE PARITY REFERENCE for the notary signer (ARCHITECTURE.md §4):
// - msg   = pureCircuits.encodeAssertion({ assertion })  (frozen encoding)
// - cFull = pureCircuits.schnorrChallenge({ann_x, ann_y, pk_x, pk_y, msg})
// - c     = cFull mod 2^248  (the circuit's getSchnorrReduction witness
//           provides q = cFull / 2^248, r = cFull mod 2^248 and asserts
//           q * 2^248 + r == cFull in-field)
// - s     = (k + c * sk) mod JUBJUB_ORDER
// Signature is (R = k*G, s); the circuit verifies s*G == R + c*pk.
import { createHash } from 'node:crypto';
import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { pureCircuits } from './managed/stride/contract/index.js';
import type { A_Assertion, Schnorr_SchnorrSignature } from './managed/stride/contract/index.js';

export const JUBJUB_ORDER =
  0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n;
const TWO_248 = 1n << 248n;

export type SchnorrSignature = Schnorr_SchnorrSignature;
export type JubjubPoint = { x: bigint; y: bigint };

export const derivePublicKey = (sk: bigint): JubjubPoint => ecMulGenerator(sk);

// Deterministic k for reproducible fixtures; production notaries use a CSPRNG.
export const deriveNonce = (sk: bigint, seed: Uint8Array): bigint => {
  const skBytes = Buffer.from(sk.toString(16).padStart(64, '0'), 'hex');
  const h = createHash('sha256').update(skBytes).update(seed).update('wf:k:').digest();
  const k = BigInt('0x' + h.toString('hex')) % (JUBJUB_ORDER - 1n);
  return k + 1n;
};

export const encodeAssertion = (assertion: A_Assertion): bigint[] =>
  pureCircuits.encodeAssertion(assertion);

export const schnorrChallenge = (
  announcement: JubjubPoint,
  pk: JubjubPoint,
  msg: bigint[]
): bigint =>
  pureCircuits.schnorrChallenge(
    announcement.x,
    announcement.y,
    pk.x,
    pk.y,
    msg
  );

export const signAssertion = (
  sk: bigint,
  assertion: A_Assertion,
  nonceSeed: Uint8Array
): SchnorrSignature => {
  const pk = derivePublicKey(sk);
  const msg = encodeAssertion(assertion);
  const k = deriveNonce(sk, nonceSeed);
  const announcement = ecMulGenerator(k);
  const cFull = schnorrChallenge(announcement, pk, msg);
  const c = cFull % TWO_248;
  const s = (k + c * sk) % JUBJUB_ORDER;
  return { announcement, response: s };
};

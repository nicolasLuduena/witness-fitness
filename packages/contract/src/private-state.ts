import type { A_Assertion, Schnorr_SchnorrSignature } from './managed/stride/contract/index.js';

export type SchnorrSignature = Schnorr_SchnorrSignature;

export type PrivateState = {
  readonly adminSecretKey: Uint8Array;
  readonly holderSecret: Uint8Array;
  readonly assertion: A_Assertion | null;
  readonly signatures: SchnorrSignature[];
  readonly commitRand: Uint8Array;
  readonly submissionRand: bigint;
  readonly wagerOpenings: [bigint, bigint, bigint, bigint];
};

export const createPrivateState = (
  adminSecretKey: Uint8Array,
  holderSecret: Uint8Array
): PrivateState => ({
  adminSecretKey,
  holderSecret,
  assertion: null,
  signatures: [],
  commitRand: new Uint8Array(32),
  submissionRand: 1n,
  wagerOpenings: [0n, 0n, 0n, 0n],
});

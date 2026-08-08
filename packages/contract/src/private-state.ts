import type { A_Assertion, Schnorr_SchnorrSignature } from "./managed/stride/contract/index.js";

export type SchnorrSignature = Schnorr_SchnorrSignature;

export type PrivateState = {
  readonly adminSecretKey: Uint8Array;
  readonly holderSecret: Uint8Array;
  readonly assertion: A_Assertion | null;
  readonly signatures: SchnorrSignature[];
  readonly commitRand: Uint8Array;
  // Bytes<32> since the sealed submission commitment is persistentCommit
  // (audit L1) — persistentCommit takes a Bytes<32> rand.
  readonly submissionRand: Uint8Array;
  readonly wagerOpenings: [bigint, Uint8Array, bigint, Uint8Array];
};

export const createPrivateState = (
  adminSecretKey: Uint8Array,
  holderSecret: Uint8Array,
): PrivateState => ({
  adminSecretKey,
  holderSecret,
  assertion: null,
  signatures: [],
  commitRand: new Uint8Array(32),
  submissionRand: new Uint8Array(32).fill(1),
  wagerOpenings: [0n, new Uint8Array(32), 0n, new Uint8Array(32)],
});

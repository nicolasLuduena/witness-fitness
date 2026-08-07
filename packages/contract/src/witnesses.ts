import { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type {
  A_Assertion,
  Ledger,
  Schnorr_SchnorrSignature,
} from './managed/stride/contract/index.js';
import type { PrivateState } from './private-state.js';

export type WitnessBase = WitnessContext<Ledger, PrivateState>;

export const TWO_248 = 452312848583266388373324160190187140051835877600158453279131187530910662656n;

export const witnesses = {
  getSchnorrReduction: ({
    privateState,
  }: WitnessBase, challengeHash: bigint): [PrivateState, [bigint, bigint]] => {
    const q = challengeHash / TWO_248;
    const r = challengeHash % TWO_248;
    return [privateState, [q, r]];
  },

  adminSecretKey: ({
    privateState,
  }: WitnessBase): [PrivateState, Uint8Array] => [
    privateState,
    privateState.adminSecretKey,
  ],

  getHolderSecret: ({
    privateState,
  }: WitnessBase): [PrivateState, Uint8Array] => [
    privateState,
    privateState.holderSecret,
  ],

  getAttestationWitness: ({
    privateState,
  }: WitnessBase): [PrivateState, [A_Assertion, Schnorr_SchnorrSignature[], Uint8Array]] => {
    if (!privateState.assertion) {
      throw new Error('getAttestationWitness: no assertion in private state');
    }
    return [privateState, [privateState.assertion, privateState.signatures, privateState.commitRand]];
  },

  getSubmissionRand: ({
    privateState,
  }: WitnessBase): [PrivateState, bigint] => [
    privateState,
    privateState.submissionRand,
  ],

  getWagerOpenings: ({
    privateState,
  }: WitnessBase): [PrivateState, [bigint, bigint, bigint, bigint]] => [
    privateState,
    privateState.wagerOpenings,
  ],
};

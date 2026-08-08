// Public surface of the contract package. pureCircuits (encodeAssertion +
// schnorrChallenge) is the single source of truth for notary signing parity
// (ARCHITECTURE.md §4) — the notary workspace MUST import these, never
// reimplement the encoding.
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { Contract as StrideContractConstructorClass } from "./managed/stride/contract/index.js";
import type { PrivateState } from "./private-state.js";
import { witnesses } from "./witnesses.js";

export const StrideContractConstructor = StrideContractConstructorClass<PrivateState>;
export type StrideContractType = InstanceType<typeof StrideContractConstructor>;

const tag = "StrideContract";
export const CompactCompiledContract = CompiledContract.make<StrideContractType, PrivateState>(
  tag,
  StrideContractConstructor,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(
    /* @vite-ignore */
    new URL("./managed/stride", import.meta.url).pathname,
  ),
);

export * from "./managed/stride/contract/index.js";
export { witnesses } from "./witnesses.js";
export { createPrivateState, type PrivateState, type SchnorrSignature } from "./private-state.js";
export {
  JUBJUB_ORDER,
  derivePublicKey,
  deriveNonce,
  encodeAssertion,
  schnorrChallenge,
  signAssertion,
  type JubjubPoint,
} from "./offchain.js";

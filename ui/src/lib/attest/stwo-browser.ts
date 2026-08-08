// Browser-compatible stwo ZK operator (chacha20/aes-ctr proofs of the TLS
// symmetric crypto), a faithful port of
// @reclaimprotocol/zk-symmetric-crypto/lib/stwo/operator.js with the WASM
// loaded from the vendored wasm-bindgen WEB build (./vendor/s2circuits.js +
// s2circuits_bg.wasm — copied from the package's resources/, which the
// published tarball does NOT ship; its published ./stwo entry is Node-only:
// `createRequire` from 'module' + `fs.readFileSync` at module scope, which
// crashes any browser bundle).
//
// Exports the SAME `makeStwoZkOperator` name/signature as the original so a
// vite alias '@reclaimprotocol/zk-symmetric-crypto/stwo' → this file repairs
// the attestor-core browser bundle without touching node_modules. Callers can
// ALSO inject these operators explicitly via createClaimOnAttestor's
// `zkOperators` option (browserStwoOperators()), which bypasses the default
// operator lookup entirely.

import type {
  EncryptionAlgorithm,
  Logger,
  ZKOperator,
  ZKProofInput,
  ZKProofPublicSignals,
} from "@reclaimprotocol/zk-symmetric-crypto";
import * as s2circuits from "./vendor/s2circuits.js";

const DEFAULT_WASM_URL = new URL("./vendor/s2circuits_bg.wasm", import.meta.url);

export type StwoWasmUrl = string | URL;

let initPromise: Promise<void> | undefined;
let wasmInitialized = false;

export async function ensureWasmInitialized(
  wasmUrl: StwoWasmUrl = DEFAULT_WASM_URL,
): Promise<void> {
  if (wasmInitialized) {
    return;
  }
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    const res = await fetch(wasmUrl);
    if (!res.ok) {
      throw new Error(`failed to fetch stwo wasm (${res.status})`);
    }
    initStwoFromBytes(new Uint8Array(await res.arrayBuffer()));
  })();
  return initPromise;
}

// Test hook / base64-embedding escape hatch: initialize the wasm from bytes
// (vitest reads the file from disk; a future build could inline it).
export function initStwoFromBytes(bytes: Uint8Array): void {
  s2circuits.initSync({ module: bytes });
  wasmInitialized = true;
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
};

const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
};

const assertU32Counter = (counter: number): void => {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffffff) {
    throw new RangeError("counter must be a uint32 integer (0 to 4294967295)");
  }
};

interface StwoWitnessJson {
  algorithm: EncryptionAlgorithm;
  key: string;
  nonce: string;
  counter: number;
  plaintext: string;
  ciphertext: string;
}

const serializeWitness = (algorithm: EncryptionAlgorithm, input: ZKProofInput): Uint8Array => {
  if (!input.noncesAndCounters?.length) {
    throw new Error("noncesAndCounters must be a non-empty array");
  }
  const { nonce, counter } = input.noncesAndCounters[0];
  assertU32Counter(counter);
  // Note: in the JS library, 'in' is ciphertext and 'out' is plaintext.
  // Stwo expects (key, nonce, counter, plaintext, ciphertext).
  const data: StwoWitnessJson = {
    algorithm,
    key: bytesToBase64(input.key),
    nonce: bytesToBase64(nonce),
    counter,
    plaintext: bytesToBase64(input.out),
    ciphertext: bytesToBase64(input.in),
  };
  return new TextEncoder().encode(JSON.stringify(data));
};

const deserializeWitness = (witness: Uint8Array): StwoWitnessJson =>
  JSON.parse(new TextDecoder().decode(witness)) as StwoWitnessJson;

const proveFromWitness = async (witness: Uint8Array): Promise<{ proof: Uint8Array }> => {
  await ensureWasmInitialized();
  const data = deserializeWitness(witness);
  const key = base64ToBytes(data.key);
  const nonce = base64ToBytes(data.nonce);
  const plaintext = base64ToBytes(data.plaintext);
  const ciphertext = base64ToBytes(data.ciphertext);
  let resultJson: string;
  switch (data.algorithm) {
    case "chacha20":
      resultJson = s2circuits.generate_chacha20_proof(
        key,
        nonce,
        data.counter,
        plaintext,
        ciphertext,
      );
      break;
    case "aes-128-ctr":
      resultJson = s2circuits.generate_aes128_ctr_proof(
        key,
        nonce,
        data.counter,
        plaintext,
        ciphertext,
      );
      break;
    case "aes-256-ctr":
      resultJson = s2circuits.generate_aes256_ctr_proof(
        key,
        nonce,
        data.counter,
        plaintext,
        ciphertext,
      );
      break;
    default:
      throw new Error(`Unsupported algorithm: ${data.algorithm}`);
  }
  const result = JSON.parse(resultJson) as { error?: string; proof?: string };
  if (result.error) {
    throw new Error(`Stwo proof generation failed: ${result.error}`);
  }
  if (!result.proof) {
    throw new Error("Stwo proof generation failed: no proof returned");
  }
  // Decode base64 to binary for compact protobuf storage (matches gnark,
  // which also returns Uint8Array).
  return { proof: base64ToBytes(result.proof) };
};

export function makeStwoZkOperator({ algorithm }: { algorithm: EncryptionAlgorithm }): ZKOperator {
  return {
    generateWitness(input) {
      // Stwo combines witness generation and proving, so we just serialize
      // the input here to be used by groth16Prove.
      return serializeWitness(algorithm, input);
    },
    async groth16Prove(witness) {
      return proveFromWitness(witness);
    },
    async groth16Verify(publicSignals: ZKProofPublicSignals, proof, logger?: Logger) {
      await ensureWasmInitialized();
      const expectedNonce = publicSignals.noncesAndCounters[0]?.nonce;
      const expectedCounter = publicSignals.noncesAndCounters[0]?.counter;
      const expectedCiphertext = publicSignals.in;
      const expectedPlaintext = publicSignals.out;
      if (!expectedNonce || expectedCounter === undefined) {
        logger?.warn("Invalid publicSignals: missing nonce or counter");
        return false;
      }
      assertU32Counter(expectedCounter);
      const proofStr = typeof proof === "string" ? proof : bytesToBase64(proof as Uint8Array);
      let resultJson: string;
      if (algorithm === "chacha20") {
        resultJson = s2circuits.verify_chacha20_proof(
          proofStr,
          expectedNonce,
          expectedCounter,
          expectedPlaintext,
          expectedCiphertext,
        );
      } else {
        resultJson = s2circuits.verify_aes_ctr_proof(
          proofStr,
          expectedNonce,
          expectedCounter,
          expectedPlaintext,
          expectedCiphertext,
        );
      }
      const result = JSON.parse(resultJson) as { error?: string; valid?: boolean };
      if (result.error) {
        logger?.warn({ error: result.error }, "Stwo STARK verification failed");
        return false;
      }
      return result.valid === true;
    },
    release() {
      // The wasm-bindgen glue keeps its own module-level instance, so we can
      // only reset our init state here (retry a failed fetch on next use).
      initPromise = undefined;
    },
  };
}

export const makeBrowserStwoZkOperator = makeStwoZkOperator;

const ALL_ALGORITHMS: EncryptionAlgorithm[] = ["chacha20", "aes-128-ctr", "aes-256-ctr"];

let operatorCache: Record<EncryptionAlgorithm, ZKOperator> | undefined;

// Map of operators for every cipher suite attestor-core may request — pass as
// createClaimOnAttestor's `zkOperators` to skip the default (Node-only)
// operator factory entirely.
export function browserStwoOperators(): Record<EncryptionAlgorithm, ZKOperator> {
  operatorCache ??= Object.fromEntries(
    ALL_ALGORITHMS.map((a) => [a, makeStwoZkOperator({ algorithm: a })]),
  ) as Record<EncryptionAlgorithm, ZKOperator>;
  return operatorCache;
}

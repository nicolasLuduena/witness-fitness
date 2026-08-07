// REST client for the 3 notary instances (NOTARY.md §4).
// POST /attestate { proofArtifacts } → { assertion, signature, notaryId }
// GET /health → { keyId, instanceId, ... }
// GET /pubkey → registered public key
//
// Every call is timeboxed (AbortController) so a dead notary degrades the
// strip to red instead of hanging the demo.

import { NOTARY_TIMEOUT_MS, NOTARY_URLS } from '../config';

export interface NotaryHealth {
  keyId?: string;
  instanceId?: string;
  [key: string]: unknown;
}

export interface NotaryPubkeyResponse {
  pubkey?: string;
  publicKey?: string;
  keyId?: string;
  [key: string]: unknown;
}

export interface NotaryAttestateResponse {
  assertion?: unknown;
  signature?: unknown;
  notaryId?: string;
  error?: string;
}

export interface ProofArtifacts {
  // Fixture shape from packages/client/fixtures + attest.ts transformProof.
  claim: unknown;
  claimSignatureHex: string;
  attestorAddress: string;
  request?: { url: string; method: string; publicHeaders: Record<string, string> };
  responseText?: string;
  extractedParameterValues?: Record<string, string>;
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs = NOTARY_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const notaryHealth = (index: number): Promise<NotaryHealth | null> =>
  fetchJson<NotaryHealth>(`${NOTARY_URLS[index]}/health`, { method: 'GET' }).catch(() => null);

export const notaryPubkey = (index: number): Promise<NotaryPubkeyResponse | null> =>
  fetchJson<NotaryPubkeyResponse>(`${NOTARY_URLS[index]}/pubkey`, { method: 'GET' }).catch(() => null);

export const notaryAttestate = async (
  index: number,
  proofArtifacts: ProofArtifacts
): Promise<NotaryAttestateResponse> => {
  try {
    return await fetchJson<NotaryAttestateResponse>(`${NOTARY_URLS[index]}/attestate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proofArtifacts }),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unreachable' };
  }
};

export const reachableNotaries = async (): Promise<boolean[]> =>
  Promise.all([0, 1, 2].map(async (i) => (await notaryHealth(i)) !== null));

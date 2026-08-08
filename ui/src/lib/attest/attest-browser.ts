// Browser port of packages/client/src/attest.ts. Differences from the Node
// client, all deliberate:
//  1. The attestor PRIVATE KEY never enters the browser — buildAttestorClient
//     fetches a signed auth request from the stateless service
//     (:8200 /attestor-auth-request).
//  2. ZK proving runs the browser stwo operator (./stwo-browser) — the same
//     circuit set (zkEngine: 'stwo') as the Node client, wasm-bindgen web
//     build instead of the Node-only published entry.
//  3. The owner key is a persisted random 32-byte ETH key (localStorage), not
//     an env var.
// Artifact shape is IDENTICAL to the client's attestRequest result:
// { claim: ClaimTunnelResponse, proof: TransformedProof } — the notary's
// normalizeArtifacts accepts it via the claimData/signatures[]/witnesses[]
// branch (verified against all 3 notary instances).

import type { proto } from '@reclaimprotocol/attestor-core';
import { ATTESTOR_WS_URL, ATTEST_SERVICE_URL } from './config';
import { browserStwoOperators } from './stwo-browser';

// The attestor-core + tls stack is LAZY-loaded (attest-time only): it
// evaluates `import { webcrypto } from 'crypto'` at module scope, which
// crashed the page at load in the browser (crypto.subtle undefined — the
// vite `crypto` alias fixes the resolution; lazy loading keeps the stack out
// of the initial bundle entirely and isolates any module-eval failure to the
// attest step where it can surface a clear error).
let corePromise: Promise<typeof import('@reclaimprotocol/attestor-core')> | null = null;

async function loadCore(): Promise<typeof import('@reclaimprotocol/attestor-core')> {
  if (!corePromise) {
    corePromise = (async () => {
      const [{ webcryptoCrypto }, { setCryptoImplementation }, core] = await Promise.all([
        import('@reclaimprotocol/tls/webcrypto'),
        import('@reclaimprotocol/tls'),
        import('@reclaimprotocol/attestor-core'),
      ]);
      setCryptoImplementation(webcryptoCrypto);
      return core;
    })();
  }
  return corePromise;
}

type ClaimTunnelResponse = proto.ClaimTunnelResponse;
type ProviderClaimData = proto.ProviderClaimData;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH';

export type ResponseMatch = { type: 'regex' | 'contains'; value: string };
export type ResponseRedaction = { regex: string; jsonPath?: string; xPath?: string };

export interface AttestRequest {
  url: string;
  method?: HttpMethod;
  publicHeaders?: Record<string, string>;
  secretHeaders?: Record<string, string>;
  responseMatches?: ResponseMatch[];
  responseRedactions?: ResponseRedaction[];
  context?: Record<string, unknown>;
  body?: string;
}

export interface TransformedProof {
  claimData: ProviderClaimData;
  identifier: string;
  signatures: string[];
  extractedParameterValues: Record<string, string>;
  witnesses: { id: string; url: string }[];
}

export interface AttestResult {
  claim: ClaimTunnelResponse;
  proof: TransformedProof;
}

export interface BrowserAttestorConfig {
  url: string;
  serviceUrl: string;
}

export function loadBrowserAttestorConfig(): BrowserAttestorConfig {
  return { url: ATTESTOR_WS_URL, serviceUrl: ATTEST_SERVICE_URL };
}

// Wire shape the tunnel handshake expects (the output of attestor-core's
// createAuthRequest): AuthenticatedUserData + ECDSA signature bytes.
export interface AttestorAuthRequest {
  data: { id: string; hostWhitelist: string[]; createdAt: number; expiresAt: number };
  signature: Uint8Array;
}

export interface AttestorClient {
  url: string;
  authRequest: AttestorAuthRequest;
}

// Service contract: POST /attestor-auth-request →
// { authRequest: { id, hostWhitelist, signature, signer } }. The signature is
// opaque to the browser (hex or base64). If the service also returns the full
// signed `data` (incl. createdAt/expiresAt), it is passed through verbatim —
// the signature covers those timestamps, so the browser MUST NOT fabricate
// them (attestor verifies against its own clock, DEFAULT_AUTH_EXPIRY_S = 15m).
export interface ServiceAuthRequest {
  id: string;
  hostWhitelist: string[];
  signature: string;
  signer?: string;
  data?: AttestorAuthRequest['data'];
}

export async function fetchAuthRequest(
  serviceUrl: string = ATTEST_SERVICE_URL,
): Promise<AttestorAuthRequest> {
  const res = await fetch(`${serviceUrl}/attestor-auth-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`attestor-auth-request failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { authRequest?: unknown };
  const raw = body.authRequest as ServiceAuthRequest | undefined;
  if (!raw || typeof raw !== 'object') {
    throw new Error('attestor-auth-request: malformed response (expected { authRequest })');
  }
  if (raw.data && typeof raw.data.id === 'string' && typeof raw.data.createdAt === 'number') {
    return { data: raw.data, signature: parseSignature(raw.signature) };
  }
  if (typeof raw.id !== 'string' || !Array.isArray(raw.hostWhitelist)) {
    throw new Error('attestor-auth-request: missing id or hostWhitelist');
  }
  const nowS = Math.floor(Date.now() / 1000);
  return {
    data: {
      id: raw.id,
      hostWhitelist: raw.hostWhitelist.filter((h): h is string => typeof h === 'string'),
      createdAt: nowS,
      expiresAt: nowS + 900,
    },
    signature: parseSignature(raw.signature),
  };
}

export async function buildAttestorClient(
  config: BrowserAttestorConfig = loadBrowserAttestorConfig(),
): Promise<AttestorClient> {
  const authRequest = await fetchAuthRequest(config.serviceUrl);
  return { url: config.url, authRequest };
}

// Attestor service signature: accepts 0x-hex, bare hex, or base64.
function parseSignature(signature: string): Uint8Array {
  const hex = signature.startsWith('0x') ? signature.slice(2) : signature;
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  const bin = atob(signature);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// Faithful port of the client's transformProof: witnesses[].id is the UTF-8
// hex of the attestor address string, exactly as the Node client encodes it —
// the notary's addressFromWitnessId round-trips it back.
export function transformProof(claim: ClaimTunnelResponse, attestorUrl: string): TransformedProof {
  if (!claim.claim || !claim.signatures) {
    throw new Error('claim missing data or signatures');
  }
  const { claim: claimData, signatures } = claim;
  return {
    claimData,
    identifier: claimData.identifier,
    signatures: ['0x' + bytesToHex(signatures.claimSignature)],
    extractedParameterValues: claimData.context
      ? (JSON.parse(claimData.context).extractedParameters ?? {})
      : {},
    witnesses: [
      {
        id: '0x' + bytesToHex(new TextEncoder().encode(signatures.attestorAddress)),
        url: attestorUrl,
      },
    ],
  };
}

// The client-side claim owner key: random 32-byte ETH key persisted
// per-origin, so a user's claims share one witness address across the demo.
// MUST be 0x-prefixed — ethers v6 (attestor-core's createClaimOnAttestor)
// rejects unprefixed hex ("invalid BytesLike value"). Legacy stored keys
// (unprefixed, from before the fix) are normalized on read.
const OWNER_KEY_STORAGE_KEY = 'wf-attest-owner-key';

const normalizeOwnerKey = (raw: string): string | null => {
  if (/^0x[0-9a-f]{64}$/.test(raw)) return raw;
  if (/^[0-9a-f]{64}$/.test(raw)) return '0x' + raw;
  return null;
};

export function getOrCreateOwnerKey(): string {
  try {
    const existing = localStorage.getItem(OWNER_KEY_STORAGE_KEY);
    const normalized = existing ? normalizeOwnerKey(existing) : null;
    if (normalized) {
      if (normalized !== existing) {
        localStorage.setItem(OWNER_KEY_STORAGE_KEY, normalized);
      }
      return normalized;
    }
  } catch {
    // fall through to a session-random key when localStorage is unavailable
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = '0x' + bytesToHex(bytes);
  try {
    localStorage.setItem(OWNER_KEY_STORAGE_KEY, key);
  } catch {
    // SSR / private mode — session key only
  }
  return key;
}

export async function attestRequest(
  req: AttestRequest,
  config: BrowserAttestorConfig = loadBrowserAttestorConfig(),
  ownerPrivateKey?: string,
): Promise<AttestResult> {
  const { createClaimOnAttestor } = await loadCore();
  const client = await buildAttestorClient(config);
  const result = await createClaimOnAttestor({
    name: 'http',
    params: {
      url: req.url,
      method: req.method ?? 'GET',
      headers: req.publicHeaders,
      responseMatches: req.responseMatches ?? [{ type: 'regex', value: '(?<data>.*)' }],
      responseRedactions: req.responseRedactions ?? [],
      body: req.body ?? '',
      paramValues: {},
    },
    secretParams: {
      cookieStr: '',
      headers: req.secretHeaders ?? {},
      paramValues: {},
    },
    context: req.context,
    ownerPrivateKey: ownerPrivateKey ?? getOrCreateOwnerKey(),
    client,
    zkEngine: 'stwo',
    zkOperators: browserStwoOperators(),
  });
  if (result.error) {
    throw new Error(`attestor error: ${result.error.message}`);
  }
  return { claim: result, proof: transformProof(result, config.url) };
}

// Same URL + headers + context as the client's attestActivities — attests the
// last 5 activities via the real Strava API through the attestor.
export const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities?per_page=5';

export function attestStrava(
  accessToken: string,
  config: BrowserAttestorConfig = loadBrowserAttestorConfig(),
): Promise<AttestResult> {
  return attestRequest(
    {
      url: STRAVA_ACTIVITIES_URL,
      method: 'GET',
      publicHeaders: { accept: 'application/json' },
      secretHeaders: { authorization: `Bearer ${accessToken}` },
      context: {
        contextAddress: '0x0000000000000000000000000000000000000000',
        contextMessage: 'witnessfitness:strava-activities',
        athleteIds: [],
      },
    },
    config,
  );
}

export async function verifyClaimSignatures(result: ClaimTunnelResponse): Promise<void> {
  const { assertValidClaimSignatures } = await loadCore();
  await assertValidClaimSignatures(result);
}

// Maps an AttestResult onto the notary's ProofArtifacts shape (the one the
// UI's notary strip consumes: claim + claimSignatureHex + attestorAddress) —
// normalizeArtifacts accepts claimSignatureHex as an alias for signatureHex.
export function proofToNotaryArtifacts(result: AttestResult): {
  claim: ProviderClaimData;
  claimSignatureHex: string;
  attestorAddress: string;
  extractedParameterValues: Record<string, string>;
  responseText?: string;
} {
  const signatureHex = result.proof.signatures[0];
  if (!signatureHex || result.proof.witnesses.length === 0) {
    throw new Error('proof missing signature or witness');
  }
  // Raw attestor address straight from the tunnel response (same value the
  // fixture path stores) — NOT the encoded witness id.
  const attestorAddress = result.claim.signatures?.attestorAddress;
  if (!attestorAddress) {
    throw new Error('claim missing attestor address');
  }
  return {
    claim: result.proof.claimData,
    claimSignatureHex: signatureHex,
    attestorAddress: attestorAddress.toLowerCase(),
    extractedParameterValues: result.proof.extractedParameterValues,
    responseText: result.proof.extractedParameterValues['data'],
  };
}

import {
  assertValidClaimSignatures,
  createAuthRequest,
  createClaimOnAttestor,
  type proto,
} from "@reclaimprotocol/attestor-core";
import { setCryptoImplementation } from "@reclaimprotocol/tls";
import { webcryptoCrypto } from "@reclaimprotocol/tls/webcrypto";

setCryptoImplementation(webcryptoCrypto);

type ClaimTunnelResponse = proto.ClaimTunnelResponse;
type ProviderClaimData = proto.ProviderClaimData;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH";

export type ResponseMatch = { type: "regex" | "contains"; value: string };
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

export interface AttestorConfig {
  url: string;
  privateKey: string;
  hostWhitelist: string[];
  userId: string;
}

export function loadAttestorConfig(env: NodeJS.ProcessEnv = process.env): AttestorConfig {
  return {
    url: env.ATTESTOR_URL ?? "wss://localhost:8001/ws",
    privateKey: requireEnv(env, "ATTESTOR_PRIVATE_KEY"),
    hostWhitelist: (env.ATTESTOR_HOST_WHITELIST ?? "www.strava.com")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    userId: env.ATTESTOR_USER_ID ?? "witnessfitness-demo",
  };
}

export async function buildAttestorClient(config: AttestorConfig) {
  const authRequest = await createAuthRequest(
    { id: config.userId, hostWhitelist: config.hostWhitelist },
    config.privateKey,
  );
  return { url: config.url, authRequest };
}

export function transformProof(claim: ClaimTunnelResponse, attestorUrl: string): TransformedProof {
  if (!claim.claim || !claim.signatures) {
    throw new Error("claim missing data or signatures");
  }
  const { claim: claimData, signatures } = claim;
  return {
    claimData,
    identifier: claimData.identifier,
    signatures: ["0x" + Buffer.from(signatures.claimSignature).toString("hex")],
    extractedParameterValues: claimData.context
      ? (JSON.parse(claimData.context).extractedParameters ?? {})
      : {},
    witnesses: [
      {
        id: "0x" + Buffer.from(signatures.attestorAddress).toString("hex"),
        url: attestorUrl,
      },
    ],
  };
}

export async function attestRequest(
  req: AttestRequest,
  config: AttestorConfig = loadAttestorConfig(),
  ownerPrivateKey?: string,
): Promise<AttestResult> {
  const client = await buildAttestorClient(config);
  const result = await createClaimOnAttestor({
    name: "http",
    params: {
      url: req.url,
      method: req.method ?? "GET",
      headers: req.publicHeaders,
      responseMatches: req.responseMatches ?? [{ type: "regex", value: "(?<data>.*)" }],
      responseRedactions: req.responseRedactions ?? [],
      body: req.body ?? "",
      paramValues: {},
    },
    secretParams: {
      cookieStr: "",
      headers: req.secretHeaders ?? {},
      paramValues: {},
    },
    context: req.context,
    ownerPrivateKey: ownerPrivateKey ?? requireEnv(process.env, "OWNER_PRIVATE_KEY"),
    client,
    zkEngine: "stwo",
  });
  if (result.error) {
    throw new Error(`attestor error: ${result.error.message}`);
  }
  return { claim: result, proof: transformProof(result, config.url) };
}

export async function verifyClaimSignatures(result: ClaimTunnelResponse): Promise<void> {
  await assertValidClaimSignatures(result);
}

export function claimIdentifier(claim: ProviderClaimData): string {
  return claim.identifier;
}

export function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`missing required env var ${name}`);
  }
  return value;
}

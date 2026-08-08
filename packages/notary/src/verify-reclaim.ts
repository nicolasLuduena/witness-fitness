// Independent verification of Reclaim proof artifacts (NOTARY.md §2).
// Uses @reclaimprotocol/attestor-core's own verification functions — the SDK
// that produced the proofs is the SDK that verifies them. Then claim-level
// sanity: host allowlist + response parses. Fails loudly otherwise.
import { createHash } from "node:crypto";
import { assertValidClaimSignatures } from "@reclaimprotocol/attestor-core";
import type { proto } from "@reclaimprotocol/attestor-core";

type ProviderClaimData = proto.ProviderClaimData;
type ClaimTunnelResponse = proto.ClaimTunnelResponse;

export interface ProofArtifacts {
  claim: ProviderClaimData;
  signatureHex: string;
  attestorAddress: string;
  responseText?: string;
  proof?: {
    extractedParameterValues?: Record<string, string>;
    witnesses?: { id: string; url: string }[];
    identifier?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface VerifiedArtifact {
  claim: ProviderClaimData;
  attestorAddress: string;
  responseText: string;
  canonicalJson: string;
  identifier: string;
}

const hexToBytes = (hex: string): Uint8Array =>
  new Uint8Array(Buffer.from(hex.replace(/^0x/, ""), "hex"));

const addressFromWitnessId = (id: string): string => {
  const hex = id.replace(/^0x/, "");
  if (/^[0-9a-fA-F]{40}$/.test(hex)) {
    return "0x" + hex.toLowerCase();
  }
  const ascii = Buffer.from(hex, "hex").toString("utf-8");
  if (/^0x[0-9a-fA-F]{40}$/.test(ascii)) {
    return ascii.toLowerCase();
  }
  throw new Error(`cannot decode attestor address from witness id ${id.slice(0, 16)}...`);
};

// Accepts either the saved fixture shape (claim + signatureHex +
// attestorAddress) or a live zk-fetch transformProof result (claimData +
// signatures[] + witnesses[]). `claimSignatureHex` is accepted as an alias
// for `signatureHex` (the UI's ProofArtifacts shape).
export const normalizeArtifacts = (input: unknown): ProofArtifacts => {
  if (typeof input !== "object" || input === null) {
    throw new Error("proof artifacts must be an object");
  }
  const raw = input as Record<string, unknown>;
  const signatureHex =
    typeof raw.signatureHex === "string"
      ? raw.signatureHex
      : (raw.claimSignatureHex as string | undefined);
  if (raw.claim && typeof signatureHex === "string" && typeof raw.attestorAddress === "string") {
    return {
      claim: raw.claim as ProviderClaimData,
      signatureHex,
      attestorAddress: (raw.attestorAddress as string).toLowerCase(),
      responseText: typeof raw.responseText === "string" ? (raw.responseText as string) : undefined,
      proof: raw.proof as ProofArtifacts["proof"] | undefined,
      metadata: raw.metadata as Record<string, unknown> | undefined,
    };
  }
  if (raw.claimData && Array.isArray(raw.signatures) && Array.isArray(raw.witnesses)) {
    const claimData = raw.claimData as ProviderClaimData;
    const witnesses = raw.witnesses as { id: string; url: string }[];
    if (witnesses.length === 0) {
      throw new Error("proof has no witnesses");
    }
    return {
      claim: claimData,
      signatureHex: (raw.signatures as string[])[0],
      attestorAddress: addressFromWitnessId(witnesses[0].id),
      responseText:
        (raw.responseText as string | undefined) ??
        ((raw as { extractedParameterValues?: Record<string, string> }).extractedParameterValues ??
          {})["data"],
      proof: raw as ProofArtifacts["proof"],
    };
  }
  throw new Error("unrecognized proof artifact shape (expected fixture or transformProof output)");
};

export const claimUrl = (claim: ProviderClaimData): string => {
  let parameters: { url?: string };
  try {
    parameters = JSON.parse(claim.parameters);
  } catch {
    throw new Error("claim parameters are not valid JSON");
  }
  if (typeof parameters.url !== "string" || parameters.url === "") {
    throw new Error("claim parameters carry no url");
  }
  return parameters.url;
};

export const assertAllowedHost = (claim: ProviderClaimData, allowedHosts: string[]): string => {
  const host = new URL(claimUrl(claim)).hostname.toLowerCase();
  const ok = allowedHosts.some((allowed) => host === allowed || host.endsWith("." + allowed));
  if (!ok) {
    throw new Error(`attested host ${host} not in allowlist [${allowedHosts.join(", ")}]`);
  }
  return host;
};

// The captured payload is an HTTP transcript (headers + body); strip headers
// and parse the body as JSON.
export const parseResponseBody = (responseText: string): unknown => {
  const body = responseText.includes("\r\n\r\n")
    ? responseText.slice(responseText.indexOf("\r\n\r\n") + 4)
    : responseText;
  const parsed: unknown = JSON.parse(body);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("response body is not a JSON object or array");
  }
  return parsed;
};

export const canonicalJson = (value: unknown): string => {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "bigint") {
      return "0x" + v.toString(16);
    }
    if (v instanceof Uint8Array) {
      return { $bytes: Buffer.from(v).toString("hex") };
    }
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) {
        throw new Error("circular structure in artifacts");
      }
      seen.add(v);
    }
    return v;
  });
};

export const verifyReclaimProof = async (
  artifacts: ProofArtifacts,
  allowedHosts: string[],
): Promise<VerifiedArtifact> => {
  const claimSignature = hexToBytes(artifacts.signatureHex);
  if (claimSignature.length !== 65) {
    throw new Error(`claim signature must be 65 bytes, got ${claimSignature.length}`);
  }
  const signatures = {
    claimSignature,
    attestorAddress: artifacts.attestorAddress,
  } as ClaimTunnelResponse["signatures"];
  await assertValidClaimSignatures({ claim: artifacts.claim, signatures });

  const host = assertAllowedHost(artifacts.claim, allowedHosts);
  const responseText =
    artifacts.responseText ?? artifacts.proof?.extractedParameterValues?.["data"];
  if (!responseText) {
    throw new Error(`no captured response for ${host}`);
  }
  parseResponseBody(responseText);

  const canonical = {
    claim: artifacts.claim,
    signatureHex: artifacts.signatureHex,
    attestorAddress: artifacts.attestorAddress,
    responseText,
    metadata: artifacts.metadata ?? null,
  };
  return {
    claim: artifacts.claim,
    attestorAddress: artifacts.attestorAddress,
    responseText,
    canonicalJson: canonicalJson(canonical),
    identifier: artifacts.claim.identifier,
  };
};

export const sha256Hex = (data: string): string =>
  createHash("sha256").update(data, "utf-8").digest("hex");

// Notary Signer HTTP API (NOTARY.md §4). Stateless per instance: POST
// /attestate verifies a Reclaim proof with the SDK, builds the typed
// assertion, signs it, and returns { assertion, signature, notaryId }.
// GET /health and GET /pubkey expose the instance's identity for the demo
// "3 notary keys" strip.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import dotenv from "dotenv";
import { loadConfig, type NotaryConfig } from "./config.js";

dotenv.config({ path: process.env.NOTARY_ENV_FILE ?? ".env" });

import { buildAssertion, metricLabel } from "./assert.js";
import { publicKeyOf, secretKeyFromHex, signAssertion } from "./sign.js";
import { normalizeArtifacts, verifyReclaimProof } from "./verify-reclaim.js";

const readBody = (req: IncomingMessage, maxBytes: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });

// Deep-convert bigint → hex string and Uint8Array → hex string before
// JSON.stringify (a replacer alone can't catch Uint8Array: toJSON fires
// first and turns Buffers into {type:'Buffer',...}).
const jsonSafe = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return "0x" + value.toString(16);
  }
  if (value instanceof Uint8Array) {
    return "0x" + Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]),
    );
  }
  return value;
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(jsonSafe(body)));
};

// CORS for the demo UI origins (vite dev :5173, vite preview :4173).
// Requests with a matching Origin get CORS headers on EVERY response;
// non-matching origins are served without them (the browser blocks — the
// correct behavior for a demo signer).
const CORS_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

const corsOriginFor = (req: IncomingMessage): string | null => {
  const origin = req.headers.origin;
  return typeof origin === "string" && CORS_ALLOWED_ORIGINS.includes(origin) ? origin : null;
};

const applyCors = (res: ServerResponse, origin: string): void => {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Vary", "Origin");
};

export interface NotaryServer {
  server: ReturnType<typeof createServer>;
  config: NotaryConfig;
  publicKey: { x: bigint; y: bigint };
}

export { metricLabel } from "./assert.js";

export const createNotaryServer = (config: NotaryConfig): NotaryServer => {
  const sk = secretKeyFromHex(config.notaryKey);
  const publicKey = publicKeyOf(sk);

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        notaryId: config.notaryId,
        keyId: "0x" + publicKey.x.toString(16).slice(0, 16),
        publicKey,
        attestorUrl: config.attestorUrl,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/pubkey") {
      sendJson(res, 200, {
        notaryId: config.notaryId,
        registeredPublicKey: publicKey,
        registered: config.contractAddress !== "",
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/attestate") {
      try {
        const body = JSON.parse(await readBody(req, config.maxBodyBytes));
        const artifacts = normalizeArtifacts(body.proofArtifacts ?? body);
        const verified = await verifyReclaimProof(artifacts, config.allowedHosts);
        const { assertion, source } = buildAssertion(verified);
        const signature = signAssertion(sk, assertion);
        sendJson(res, 200, {
          notaryId: config.notaryId,
          assertion,
          signature,
          metricSource: source,
          identifier: verified.identifier,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, { error: message });
      }
      return;
    }
    sendJson(res, 404, { error: "not found" });
  };

  const server = createServer((req, res) => {
    const origin = corsOriginFor(req);
    if (origin !== null) {
      applyCors(res, origin);
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    handler(req, res).catch((error) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  return { server, config, publicKey };
};

const isMain = (): boolean => {
  const args = process.argv[1];
  return args !== undefined && import.meta.url === new URL(`file://${args}`).href;
};

if (isMain()) {
  const { server, config, publicKey } = createNotaryServer(loadConfig());
  server.listen(config.port, () => {
    console.log(
      `[notary ${config.notaryId}] listening on :${config.port} keyId=0x${publicKey.x
        .toString(16)
        .slice(0, 16)}`,
    );
  });
}

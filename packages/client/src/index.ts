import "dotenv/config";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AttestResult,
  attestRequest,
  transformProof,
  verifyClaimSignatures,
} from "./attest.ts";
import { FIXTURES_DIR, type FixtureFile, saveFixture, verifyFixture } from "./fixtures.ts";
import {
  buildAuthUrl,
  exchangeCode,
  fetchActivities,
  getValidAccessToken,
  loadStravaConfig,
  type StravaActivity,
} from "./strava.ts";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(SRC_DIR, "..", ".env");

const ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities?per_page=5";
const ACTIVITY_URL = (id: number) =>
  `https://www.strava.com/api/v3/activities/${id}?include_all_efforts=false`;

interface StravaContextMeta {
  athleteId?: number;
  activityId?: number;
  distanceM?: number;
  movingTimeS?: number;
  startDate?: string;
  url: string;
  label?: string;
}

function activitiesContext(activities: StravaActivity[]) {
  return {
    contextAddress: "0x0000000000000000000000000000000000000000",
    contextMessage: "witnessfitness:strava-activities",
    athleteIds: activities.map((a) => a.id),
  };
}

async function attestActivities(accessToken: string): Promise<AttestResult> {
  return attestRequest({
    url: ACTIVITIES_URL,
    method: "GET",
    publicHeaders: { accept: "application/json" },
    secretHeaders: { authorization: `Bearer ${accessToken}` },
    context: activitiesContext([]),
  });
}

async function attestSingleActivity(
  accessToken: string,
  activity: StravaActivity,
): Promise<AttestResult> {
  return attestRequest({
    url: ACTIVITY_URL(activity.id),
    method: "GET",
    publicHeaders: { accept: "application/json" },
    secretHeaders: { authorization: `Bearer ${accessToken}` },
    context: {
      contextAddress: "0x0000000000000000000000000000000000000000",
      contextMessage: "witnessfitness:strava-activity",
      athleteId: activity.id,
    },
  });
}

function parseActivitiesFromProof(result: AttestResult): StravaActivity[] {
  const raw = result.proof.extractedParameterValues["data"];
  if (!raw) {
    throw new Error("no data captured in proof");
  }
  const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
  const parsed = JSON.parse(body);
  if (!Array.isArray(parsed)) {
    throw new Error(`captured response is not an activities array: ${body.slice(0, 120)}`);
  }
  return parsed as StravaActivity[];
}

async function cmdAuth() {
  const config = loadStravaConfig();
  const url = buildAuthUrl(config);
  console.log("1. Open this URL in a browser and authorize the app:");
  console.log(url);
  console.log("2. Waiting for the redirect at", config.redirectUri, "...");
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url!, "http://localhost");
      const code = reqUrl.searchParams.get("code");
      res.setHeader("Content-Type", "text/html");
      if (code) {
        res.end("<h1>Authorized. You can close this tab.</h1>");
        server.close();
        resolve(code);
      } else {
        res.end(`<h1>Error: ${reqUrl.searchParams.get("error")}</h1>`);
        server.close();
        reject(new Error(`oauth error: ${reqUrl.searchParams.get("error")}`));
      }
    });
    server.listen(8080, () => {});
  });
  const tokens = await exchangeCode(config, code);
  upsertEnv({
    STRAVA_ACCESS_TOKEN: tokens.access_token,
    STRAVA_REFRESH_TOKEN: tokens.refresh_token,
    STRAVA_TOKEN_EXPIRES_AT: String(tokens.expires_at),
  });
  console.log(
    `authorized athlete id=${tokens.athlete.id} ${tokens.athlete.firstname} ${tokens.athlete.lastname}`,
  );
  console.log("tokens written to packages/client/.env");
}

async function cmdProof() {
  const strava = loadStravaConfig();
  const accessToken = await getValidAccessToken(strava);
  const result = await attestActivities(accessToken);
  await verifyClaimSignatures(result.claim);
  console.log("PROOF OK — claim verified (signature valid)");
  console.log("identifier:", result.proof.identifier);
  console.log("owner:", result.claim.claim!.owner);
  console.log("timestampS:", result.claim.claim!.timestampS);
  const activities = parseActivitiesFromProof(result);
  for (const a of activities) {
    console.log(
      `  activity ${a.id} distance=${a.distance}m moving_time=${a.moving_time}s start=${a.start_date}`,
    );
  }
}

async function cmdFixtures(count: number) {
  const strava = loadStravaConfig();
  const accessToken = await getValidAccessToken(strava);
  const activities = await fetchActivities(accessToken, 5);
  const sorted = [...activities].sort((a, b) => b.distance - a.distance);
  const picked = pickForContrast(sorted, count);
  const paths: string[] = [];
  for (const activity of picked) {
    const result = await attestSingleActivity(accessToken, activity);
    await verifyClaimSignatures(result.claim);
    const path = await saveFixture(
      result,
      {
        athleteId: activity.athlete?.id ?? activity.id,
        activityId: activity.id,
        distanceM: activity.distance,
        movingTimeS: activity.moving_time,
        startDate: activity.start_date,
        url: ACTIVITY_URL(activity.id),
        label: "activity",
      },
      "live-strava",
    );
    paths.push(path);
    console.log(`saved ${path} (${activity.distance}m, ${activity.start_date})`);
  }
  console.log(`fixtures: ${paths.length}`);
}

function pickForContrast(sorted: StravaActivity[], count: number): StravaActivity[] {
  if (sorted.length <= count) return sorted;
  const picked: StravaActivity[] = [];
  const step = (sorted.length - 1) / Math.max(count - 1, 1);
  for (let i = 0; i < count; i++) {
    picked.push(sorted[Math.round(i * step)]);
  }
  return picked;
}

async function cmdVerify(path?: string) {
  const files = path
    ? [path]
    : readdirFixtures()
        .filter((f) => f.endsWith(".json"))
        .map((f) => join(FIXTURES_DIR, f));
  if (files.length === 0) {
    throw new Error("no fixtures found");
  }
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(file, "utf-8")) as FixtureFile;
    await verifyFixture(fixture);
    const proof = transformProof(
      {
        claim: fixture.claim,
        signatures: {
          claimSignature: new Uint8Array(Buffer.from(fixture.signatureHex.slice(2), "hex")),
          attestorAddress: fixture.attestorAddress,
        } as import("@reclaimprotocol/attestor-core").proto.ClaimTunnelResponse["signatures"],
        request: undefined,
      },
      "ws://localhost:8001/ws",
    );
    console.log(
      `VERIFIED ${file} | id=${fixture.claim.identifier} | ${fixture.metadata.distanceM}m | source=${fixture.source}`,
    );
  }
}

function readdirFixtures(): string[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR);
}

function upsertEnv(updates: Record<string, string>) {
  let content = "";
  if (existsSync(ENV_PATH)) {
    content = readFileSync(ENV_PATH, "utf-8");
  }
  const lines = content.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"));
  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    const line = `${key}=${value}`;
    if (idx >= 0) {
      lines[idx] = line;
    } else {
      lines.push(line);
    }
  }
  writeFileSync(ENV_PATH, lines.join("\n") + "\n");
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case "auth":
    await cmdAuth();
    break;
  case "proof":
    await cmdProof();
    break;
  case "fixtures":
    await cmdFixtures(Number(arg ?? 3));
    break;
  case "verify":
    await cmdVerify(arg);
    break;
  default:
    console.log("usage: tsx src/index.ts <auth|proof|fixtures [n]|verify [path]>");
    process.exit(1);
}

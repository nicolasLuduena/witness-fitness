// Build the typed Assertion per CONTRACT.md §2 using the contract's compiled
// A_Assertion type. Field order is contract law (assertion.compact / the
// frozen 22-field encoding in encodeAssertion). All three notary instances
// must sign the SAME assertion, so nonce and reclaimProofHash are derived
// deterministically from the verified artifacts (per-artifact randomness, not
// per-instance randomness).
import type { A_Assertion } from '@witnessfitness/contract';
import { sha256Hex, type VerifiedArtifact } from './verify-reclaim.js';

export const METRIC_DISTANCE = 1n;
export const METRIC_MOVING_TIME = 2n;

export type MetricSource = 'strava' | 'fixture-demo';

export interface ExtractedMetrics {
  claims: { metricId: bigint; value: bigint }[];
  source: MetricSource;
}

const isStravaHost = (url: string): boolean => /strava\.com$/i.test(new URL(url).hostname);

const round = (value: number): bigint => BigInt(Math.round(value));

export const extractMetrics = (
  verified: VerifiedArtifact,
  responseBody: unknown
): ExtractedMetrics => {
  const url = verified.claim.parameters;
  const parameters: { url?: string } = JSON.parse(url);
  const target = parameters.url ?? '';

  if (isStravaHost(target)) {
    const activities = Array.isArray(responseBody) ? responseBody : [responseBody];
    const first = activities[0] as Record<string, unknown> | undefined;
    if (typeof first?.distance !== 'number' || typeof first.moving_time !== 'number') {
      throw new Error('strava activity response missing distance/moving_time');
    }
    return {
      claims: [
        { metricId: METRIC_DISTANCE, value: round(first.distance) },
        { metricId: METRIC_MOVING_TIME, value: round(first.moving_time) },
      ],
      source: 'strava',
    };
  }

  // Fixture-replay mode (fallback mechanics, identical crypto path): the
  // saved public-API fixture carries a real attested number; map it to the
  // demo metric slots so the wager/streak flows can run end-to-end.
  if (new URL(target).hostname === 'api.github.com') {
    const repo = responseBody as Record<string, unknown>;
    if (typeof repo.stargazers_count !== 'number') {
      throw new Error('github fixture response missing stargazers_count');
    }
    return {
      claims: [{ metricId: METRIC_DISTANCE, value: round(repo.stargazers_count) }],
      source: 'fixture-demo',
    };
  }

  throw new Error(`no metric extractor for host ${new URL(target).hostname}`);
};

const PADDING_CLAIM = { metricId: 0n, value: 0n };

export const buildAssertion = (
  verified: VerifiedArtifact
): { assertion: A_Assertion; source: MetricSource } => {
  const responseBody = JSON.parse(verified.responseText.split('\r\n\r\n').slice(-1)[0]);
  const { claims, source } = extractMetrics(verified, responseBody);
  const padded = [...claims];
  while (padded.length < 8) {
    padded.push(PADDING_CLAIM);
  }
  const artifactHash = sha256Hex(verified.canonicalJson);
  return {
    assertion: {
      version: 1n,
      provider: 1n,
      claims: padded,
      claimCount: BigInt(claims.length),
      timestamp: BigInt(verified.claim.timestampS),
      nonce: Buffer.from(sha256Hex(verified.identifier + ':' + artifactHash), 'hex'),
      reclaimProofHash: Buffer.from(artifactHash, 'hex'),
    },
    source,
  };
};

export const metricLabel = (metricId: bigint): string => {
  switch (metricId) {
    case METRIC_DISTANCE:
      return 'distance';
    case METRIC_MOVING_TIME:
      return 'moving_time';
    default:
      return 'unknown';
  }
};

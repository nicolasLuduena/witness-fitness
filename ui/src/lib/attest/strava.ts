// SPA OAuth + token handling for Strava (browser port of
// packages/client/src/strava.ts). The client secret never appears here: the
// stateless service (:8200) performs /strava/exchange and /strava/refresh.
// Tokens persist per-origin in localStorage (localStorage is inherently
// per-origin — no manual namespacing needed beyond the key).

import { ATTEST_SERVICE_URL, STRAVA_CLIENT_ID, stravaRedirectUri } from './config';

export interface StravaAthlete {
  id: number;
  firstname: string;
  lastname: string;
}

// Service contract: POST /strava/exchange { code } → this shape (subset of
// Strava's own token response; the athlete payload is the dynamic identity).
export interface StravaExchangeResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: StravaAthlete;
}

// Service contract: POST /strava/refresh { refresh_token } → this shape.
export interface StravaRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface StravaActivity {
  id: number;
  distance: number;
  moving_time: number;
  start_date: string;
  athlete?: { id: number };
}

export type StoredTokens = StravaExchangeResponse;

const TOKEN_STORAGE_KEY = 'wf-strava-tokens';

export interface TokenStore {
  load(): StoredTokens | null;
  save(tokens: StoredTokens): void;
  clear(): void;
}

export const localStorageTokenStore: TokenStore = {
  load() {
    try {
      const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredTokens>;
      if (typeof parsed.access_token !== 'string' || typeof parsed.refresh_token !== 'string') {
        return null;
      }
      return parsed as StoredTokens;
    } catch {
      return null;
    }
  },
  save(tokens: StoredTokens) {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  },
  clear() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  },
};

export function buildAuthUrl(opts: { clientId?: string; redirectUri?: string } = {}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId ?? STRAVA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: opts.redirectUri ?? stravaRedirectUri(),
    scope: 'read,activity:read_all',
    approval_prompt: 'auto',
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

export interface AuthCallback {
  code?: string;
  error?: string;
}

export function parseAuthCallback(url: string | URL): AuthCallback {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  return {
    code: parsed.searchParams.get('code') ?? undefined,
    error: parsed.searchParams.get('error') ?? undefined,
  };
}

export async function exchangeCode(
  code: string,
  serviceUrl: string = ATTEST_SERVICE_URL,
): Promise<StravaExchangeResponse> {
  const res = await fetch(`${serviceUrl}/strava/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new Error(`strava token exchange failed: ${await errorMessage(res)}`);
  }
  return (await res.json()) as StravaExchangeResponse;
}

export async function refreshAccessToken(
  refreshToken: string,
  serviceUrl: string = ATTEST_SERVICE_URL,
): Promise<StravaRefreshResponse> {
  const res = await fetch(`${serviceUrl}/strava/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`strava token refresh failed: ${await errorMessage(res)}`);
  }
  return (await res.json()) as StravaRefreshResponse;
}

// Same logic as the client's getValidAccessToken: reuse a still-valid access
// token (60s slack), otherwise refresh through the service and persist.
export async function getValidAccessToken(
  store: TokenStore = localStorageTokenStore,
  serviceUrl: string = ATTEST_SERVICE_URL,
): Promise<string> {
  const tokens = store.load();
  if (!tokens) {
    throw new Error('no strava tokens stored; run the OAuth flow first');
  }
  const nowS = Math.floor(Date.now() / 1000);
  if (tokens.access_token && tokens.expires_at > nowS + 60) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) {
    throw new Error('no valid access token and no refresh token; run the auth flow first');
  }
  const fresh = await refreshAccessToken(tokens.refresh_token, serviceUrl);
  store.save({ ...fresh, athlete: tokens.athlete });
  return fresh.access_token;
}

export function shouldRefresh(tokens: StoredTokens): boolean {
  return tokens.expires_at <= Math.floor(Date.now() / 1000) + 60;
}

// Strava's API answers browser CORS with `access-control-allow-origin: *`
// (verified 2026-08-07) — direct fetch is viable. The URL is isolated here so
// a service-proxy fallback can swap the base without touching callers.
export const STRAVA_ACTIVITIES_ENDPOINT = 'https://www.strava.com/api/v3/athlete/activities';

export async function fetchActivities(
  accessToken: string,
  perPage = 5,
): Promise<StravaActivity[]> {
  const res = await fetch(`${STRAVA_ACTIVITIES_ENDPOINT}?per_page=${perPage}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`strava activities failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error(`unexpected strava response shape: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body as StravaActivity[];
}

export type EmptyAccountGuard =
  | { canInteract: true; activities: StravaActivity[] }
  | { canInteract: false; reason: 'no-activities'; activities: StravaActivity[] };

// Post-OAuth guard: an account with zero activities cannot produce meaningful
// attestations (the demo wagers on real distances). Expose the verdict — the
// gating wiring (disabling interactions) is the Round-2 agent's job.
export async function emptyAccountGuard(accessToken: string): Promise<EmptyAccountGuard> {
  const activities = await fetchActivities(accessToken);
  if (activities.length === 0) {
    return { canInteract: false, reason: 'no-activities', activities };
  }
  return { canInteract: true, activities };
}

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  if (body && typeof body.error === 'string') {
    return body.error;
  }
  return `HTTP ${res.status}`;
}

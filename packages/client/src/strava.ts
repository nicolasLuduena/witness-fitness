import { requireEnv } from './attest.ts'

export interface StravaTokenResponse {
  token_type: string
  access_token: string
  expires_at: number
  expires_in: number
  refresh_token: string
  athlete: { id: number; firstname: string; lastname: string }
}

export interface StravaActivity {
  id: number
  distance: number
  moving_time: number
  start_date: string
  athlete?: { id: number }
}

export interface StravaConfig {
  clientId: string
  clientSecret: string
  accessToken: string
  refreshToken: string
  tokenExpiresAt: number
  redirectUri: string
}

export function loadStravaConfig(env: NodeJS.ProcessEnv = process.env): StravaConfig {
  return {
    clientId: requireEnv(env, 'STRAVA_CLIENT_ID'),
    clientSecret: requireEnv(env, 'STRAVA_CLIENT_SECRET'),
    accessToken: env.STRAVA_ACCESS_TOKEN ?? '',
    refreshToken: env.STRAVA_REFRESH_TOKEN ?? '',
    tokenExpiresAt: Number(env.STRAVA_TOKEN_EXPIRES_AT ?? 0),
    redirectUri: env.STRAVA_REDIRECT_URI ?? 'http://localhost:8080/exchange',
  }
}

export function buildAuthUrl(config: StravaConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: 'read,activity:read_all',
    approval_prompt: 'auto',
  })
  return `https://www.strava.com/oauth/authorize?${params.toString()}`
}

export async function exchangeCode(
  config: StravaConfig,
  code: string,
): Promise<StravaTokenResponse> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    throw new Error(`strava token exchange failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as StravaTokenResponse
}

export async function refreshAccessToken(
  config: StravaConfig,
): Promise<StravaTokenResponse> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    throw new Error(`strava token refresh failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as StravaTokenResponse
}

export async function getValidAccessToken(
  config: StravaConfig,
  persist: (tokens: StravaTokenResponse) => void = () => {},
): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000)
  if (config.accessToken && config.tokenExpiresAt > nowS + 60) {
    return config.accessToken
  }
  if (!config.refreshToken) {
    throw new Error('no valid access token and no refresh token; run the auth flow first')
  }
  const tokens = await refreshAccessToken(config)
  persist(tokens)
  return tokens.access_token
}

export async function fetchActivities(
  accessToken: string,
  perPage = 5,
): Promise<StravaActivity[]> {
  const res = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )
  if (!res.ok) {
    throw new Error(`strava activities failed: ${res.status} ${await res.text()}`)
  }
  const body = (await res.json()) as StravaActivity[]
  if (!Array.isArray(body)) {
    throw new Error(`unexpected strava response shape: ${JSON.stringify(body).slice(0, 200)}`)
  }
  return body
}

export function activityKey(activity: StravaActivity): string {
  return `strava-${activity.id}`
}

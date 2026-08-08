// Attestation module configuration (VITE_* pattern — mirrors src/config.ts).
// No secrets live here: the Strava client id is public by design (the client
// secret exists ONLY server-side on the stateless service :8200), and the
// attestor private key NEVER reaches the browser — signed auth requests are
// fetched from the service instead.

export const ATTESTOR_WS_URL = import.meta.env.VITE_WF_ATTESTOR_URL ?? 'ws://localhost:8001/ws';

// Stateless service (:8200) — /attestor-auth-request, /strava/exchange,
// /strava/refresh. Same env name + default as the shared SIDECAR_URL.
export const ATTEST_SERVICE_URL =
  import.meta.env.VITE_WF_SIDECAR_URL ?? 'http://127.0.0.1:8200';

// Demo Strava app client id (public — see packages/client/.env). Must be
// overridden via VITE_WF_STRAVA_CLIENT_ID for another app.
export const STRAVA_CLIENT_ID = import.meta.env.VITE_WF_STRAVA_CLIENT_ID ?? '270524';

export const STRAVA_CALLBACK_PATH = '/strava/callback';

// The Strava app's redirect_uri list must contain this origin+path (register
// `${origin}/strava/callback` in the Strava app settings).
export function stravaRedirectUri(): string {
  if (typeof window === 'undefined') {
    return `http://localhost:5173${STRAVA_CALLBACK_PATH}`;
  }
  return `${window.location.origin}${STRAVA_CALLBACK_PATH}`;
}

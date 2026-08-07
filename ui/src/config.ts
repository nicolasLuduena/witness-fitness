// Runtime configuration. All values overridable via Vite env (VITE_*).
// No secrets live here — demo keys are public by design (registered on-chain).

export const SIDECAR_URL =
  import.meta.env.VITE_WF_SIDECAR_URL ?? 'http://127.0.0.1:8200';

export const NOTARY_PORTS = [8101, 8102, 8103];

export const NOTARY_URLS = NOTARY_PORTS.map((port) => `http://127.0.0.1:${port}`);

export const INDEXER_URL =
  import.meta.env.VITE_WF_INDEXER_URL ?? 'http://127.0.0.1:8088/api/v3/graphql';

export const INDEXER_WS_URL =
  import.meta.env.VITE_WF_INDEXER_WS_URL ?? 'ws://127.0.0.1:8088/api/v3/graphql/ws';

export const PROOF_SERVER_URL = import.meta.env.VITE_WF_PROOF_SERVER_URL ?? 'http://127.0.0.1:6300';

export type DemoMode = 'fixture' | 'live' | 'wallet';

// Network id the devnet + Lace connect with (reference app convention).
export const NETWORK_ID = 'undeployed';

// Minimum DApp Connector apiVersion the wallet mode accepts.
export const MIN_WALLET_API_VERSION = '3.0.0';

const DEFAULT_MODE: DemoMode =
  (import.meta.env.VITE_WF_MODE as DemoMode | undefined) === 'live' ? 'live' : 'fixture';

export const INITIAL_MODE: DemoMode =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('mode') === 'live' ||
    new URLSearchParams(window.location.search).get('mode') === 'wallet')
    ? (new URLSearchParams(window.location.search).get('mode') as DemoMode)
    : DEFAULT_MODE;

// per-request timeout for sidecar calls (ms). Submit beats (attest,
// streak/advance, badge/mint) run 9-15s on the devnet (notary fan-out + proof
// gen + inclusion + readback) — 12s caused spurious client-side timeouts in
// the live rehearsal (2026-08-07). Offline failures are still fast: a dead
// sidecar refuses the connection immediately.
export const SIDECAR_TIMEOUT_MS = 25_000;

// per-request timeout for notary strip health probes (ms)
export const NOTARY_TIMEOUT_MS = 2_000;

import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
// Track 0.1 browser-wallet provider stack tests: provider slot assembly,
// export→import roundtrip (password-encrypted private state), wrong-password
// rejection, and joinStrideFromBrowser readState against the devnet indexer
// (timeboxed; skipped with a note if the devnet is unreachable).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { createPrivateState, type PrivateState } from '@witnessfitness/contract';
import {
  browserPrivateStateProvider,
  deriveBrowserHolderSecret,
  exportPrivateState,
  importPrivateState,
  inMemoryPrivateStateProvider,
  initializeProviders,
  joinStrideFromBrowser,
  resetPrivateState,
} from '../src/browser.js';

const API_DIR = dirname(fileURLToPath(import.meta.url));
const CONTRACT_DIR = join(API_DIR, '..', '..', 'contract');
const MANAGED_DIR = join(CONTRACT_DIR, 'dist', 'managed', 'stride');
const DEPLOY_OUTPUT = JSON.parse(
  readFileSync(join(CONTRACT_DIR, 'deploy-output.json'), 'utf-8')
) as { contractAddress: string };

// The dapp-connector ConnectedAPI surface is large; the provider stack uses
// the subset below, so the stub implements those and casts (test-only).
const stubConnectedAPI = (
  overrides: Partial<{ indexerUri: string; indexerWsUri: string; proverServerUri: string }> = {}
): ConnectedAPI => {
  const config = {
    indexerUri: 'http://127.0.0.1:8088/api/v3/graphql',
    indexerWsUri: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
    proverServerUri: 'http://127.0.0.1:6300',
    ...overrides,
  };
  const submitted: string[] = [];
  return {
    getConfiguration: async () => ({
      indexerUri: config.indexerUri,
      indexerWsUri: config.indexerWsUri,
      proverServerUri: config.proverServerUri,
      substrateNodeUri: 'http://127.0.0.1:9944',
      networkId: 'devnet',
    }),
    getShieldedAddresses: async () => ({
      shieldedAddress: 'addr_test',
      shieldedCoinPublicKey: '0'.repeat(64),
      shieldedEncryptionPublicKey: '1'.repeat(64),
    }),
    balanceUnsealedTransaction: async (tx: string) => ({ tx }),
    submitTransaction: async (tx: string) => {
      submitted.push(tx);
    },
    submitted,
  } as unknown as ConnectedAPI & { submitted: string[] };
};

const realisticPrivateState = (): PrivateState => ({
  adminSecretKey: new Uint8Array(32).fill(0),
  holderSecret: new Uint8Array(32).fill(0x42),
  assertion: {
    version: 1n,
    provider: 1n,
    claims: Array.from({ length: 8 }, (_v, i) => ({ metricId: i === 0 ? 1n : 0n, value: i === 0 ? 12345n : 0n })),
    claimCount: 1n,
    timestamp: 1786000000n,
    nonce: new Uint8Array(32).fill(7),
    reclaimProofHash: new Uint8Array(32).fill(9),
  },
  signatures: [
    { announcement: { x: 1n, y: 2n }, response: 3n },
    { announcement: { x: 4n, y: 5n }, response: 6n },
    { announcement: { x: 0n, y: 1n }, response: 0n },
  ],
  commitRand: new Uint8Array(32).fill(0x11),
  submissionRand: 42n,
  wagerOpenings: [1n, 2n, 3n, 4n],
});

describe('browser provider stack', () => {
  let origin: string;
  let assetServer: ReturnType<typeof createServer>;
  let originalFetch: typeof fetch;
  let originalWindow: unknown;
  let stub: ConnectedAPI & { submitted: string[] };

  beforeAll(async () => {
    // Serve the compiled contract's ZK artifacts at /managed/stride — the
    // same URL the ui serves via `pnpm copy-keys`.
    assetServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const rel = url.pathname.replace(/^\/managed\/stride\//, '');
      if (rel === url.pathname) {
        res.writeHead(404).end('not found');
        return;
      }
      try {
        const data = readFileSync(join(MANAGED_DIR, rel));
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    await new Promise<void>((resolve) => assetServer.listen(0, resolve));
    const { port } = assetServer.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;

    originalFetch = globalThis.fetch;
    originalWindow = (globalThis as Record<string, unknown>).window;
    // The WASM runtime resolves crypto through window when it exists, and
    // ApolloClient reads navigator.userAgent — the stub must carry both.
    (globalThis as Record<string, unknown>).window = {
      location: { origin },
      crypto: globalThis.crypto,
      navigator: { userAgent: 'vitest' },
    };

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(`${origin}/managed/stride/`)) {
        const rel = url.slice(`${origin}/managed/stride/`.length);
        try {
          const data = readFileSync(join(MANAGED_DIR, rel));
          return Promise.resolve(
            new Response(data, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
          );
        } catch {
          return Promise.resolve(new Response('not found', { status: 404 }));
        }
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    stub = stubConnectedAPI();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = originalWindow;
    }
    await new Promise<void>((resolve) => assetServer.close(() => resolve()));
  });

  it('initializeProviders configures the network id before any operation', async () => {
    await initializeProviders(stub);
    // The stub wallet reports networkId 'devnet' — the module must have
    // called setNetworkId(config.networkId) (the browser path previously
    // threw "Network ID has not been configured" on every circuit call).
    expect(getNetworkId()).toBe('devnet');
  });

  it('initializeProviders returns all provider slots wired to the stub wallet', async () => {
    const providers = await initializeProviders(stub);
    expect(providers.privateStateProvider).toBeDefined();
    expect(providers.zkConfigProvider).toBeDefined();
    expect(providers.proofProvider).toBeDefined();
    expect(providers.publicDataProvider).toBeDefined();
    expect(providers.walletProvider.getCoinPublicKey()).toBe('0'.repeat(64));
    expect(providers.walletProvider.getEncryptionPublicKey()).toBe('1'.repeat(64));
    expect(typeof providers.walletProvider.balanceTx).toBe('function');
    expect(typeof providers.midnightProvider.submitTx).toBe('function');
  });

  it('export → import roundtrip restores the identical private state', async () => {
    const provider = inMemoryPrivateStateProvider<string, PrivateState>();
    provider.setContractAddress('0xabc');
    const original = realisticPrivateState();
    await provider.set('wf-demo', original);

    const payload = await provider.exportPrivateState('correct-horse-battery', 'demo-store');
    expect(() => JSON.parse(payload)).not.toThrow();
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['data', 'iv', 'salt']);

    provider.resetPrivateState('demo-store');
    expect(await provider.get('wf-demo')).toBeNull();

    await provider.importPrivateState('correct-horse-battery', 'demo-store', payload);
    const restored = await provider.get('wf-demo');
    expect(restored).toEqual(original);
  });

  it('import with the wrong password fails with a clear error', async () => {
    const provider = inMemoryPrivateStateProvider<string, PrivateState>();
    provider.setContractAddress('0xabc');
    await provider.set('wf-demo', realisticPrivateState());
    const payload = await provider.exportPrivateState('correct-horse-battery', 'demo-store');
    provider.resetPrivateState('demo-store');
    await expect(
      provider.importPrivateState('wrong-password-here', 'demo-store', payload)
    ).rejects.toThrow();
  });

  it('import rejects a malformed payload', async () => {
    const provider = inMemoryPrivateStateProvider<string, PrivateState>();
    await expect(
      provider.importPrivateState('correct-horse-battery', 'demo-store', 'not-json')
    ).rejects.toThrow();
    await expect(
      provider.importPrivateState('correct-horse-battery', 'demo-store', '{"salt":"x"}')
    ).rejects.toThrow(/Malformed payload/);
  });

  it('short passwords are rejected up front', async () => {
    const provider = inMemoryPrivateStateProvider<string, PrivateState>();
    provider.setContractAddress('0xabc');
    await provider.set('wf-demo', realisticPrivateState());
    await expect(provider.exportPrivateState('short', 'demo-store')).rejects.toThrow(
      /at least 16 characters/
    );
  });

  it('deriveBrowserHolderSecret yields 32 random bytes', () => {
    const a = deriveBrowserHolderSecret();
    const b = deriveBrowserHolderSecret();
    expect(a).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('signing-key export/import roundtrips via the interface methods', async () => {
    const provider = inMemoryPrivateStateProvider<string, PrivateState>();
    await provider.setSigningKey('0xabc', new Uint8Array(32).fill(0x77));
    const exported = await provider.exportSigningKeys({ password: 'correct-horse-battery' });
    await provider.clearSigningKeys();
    const result = await provider.importSigningKeys(exported, { password: 'correct-horse-battery' });
    expect(result).toEqual({ imported: 1, skipped: 0, overwritten: 0 });
    expect(await provider.getSigningKey('0xabc')).toEqual(new Uint8Array(32).fill(0x77));
  });

  it(
    'joinStrideFromBrowser yields a StrideContract whose readState works (devnet, timeboxed)',
    async () => {
      const devnetUp = await isIndexerUp();
      if (!devnetUp) {
        console.warn('[browser.test] devnet indexer unreachable — skipping readState test');
        return;
      }
      const contract = await withTimeout(
        joinStrideFromBrowser(stub, DEPLOY_OUTPUT.contractAddress, 'wf-browser-test'),
        60_000,
        'joinStrideFromBrowser'
      );
      const state = await withTimeout(contract.readState(), 30_000, 'readState');
      expect(state.registry).toHaveLength(3);
      expect(state.adminSecret).not.toBe(0n);
    },
    120_000
  );
});

const isIndexerUp = async (): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch('http://127.0.0.1:8088/api/v3/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
};

const withTimeout = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
    ),
  ]);


describe('P0-3 backup/restore module surface (browser entry)', () => {
  let p0Stub: ConnectedAPI & { submitted: string[] };
  let p0Window: unknown;

  beforeAll(async () => {
    // The main describe's afterAll already restored the globals — re-stub
    // the minimal browser surface this describe needs.
    p0Window = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = {
      location: { origin: 'http://127.0.0.1:9' },
      crypto: globalThis.crypto,
      navigator: { userAgent: 'vitest' },
    };
    p0Stub = stubConnectedAPI();
  });

  afterAll(() => {
    if (p0Window === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = p0Window;
    }
  });

  it('exports exportPrivateState / importPrivateState / resetPrivateState (the exact P0-3 bug)', () => {
    expect(typeof exportPrivateState).toBe('function');
    expect(typeof importPrivateState).toBe('function');
    expect(typeof resetPrivateState).toBe('function');
  });

  it('initializeProviders hands out the module singleton provider', async () => {
    const providers = await initializeProviders(p0Stub);
    expect(providers.privateStateProvider).toBe(browserPrivateStateProvider);
  });

  it('real path: set → export → reset → import → deep-equal restore; wrong password rejects', async () => {
    // Seed the singleton via the REAL provider stack path (same map the
    // wallet flow uses).
    browserPrivateStateProvider.setContractAddress('0xabc');
    const original = realisticPrivateState();
    await browserPrivateStateProvider.set('wf-demo', original);

    const payload = await exportPrivateState('correct-horse-battery', 'wf-demo-store');
    expect(typeof payload).toBe('string');
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['data', 'iv', 'salt']);

    await resetPrivateState('wf-demo-store');
    expect(await browserPrivateStateProvider.get('wf-demo')).toBeNull();

    await importPrivateState('correct-horse-battery', 'wf-demo-store', payload);
    const restored = await browserPrivateStateProvider.get('wf-demo');
    expect(restored).toEqual(original);

    // Wrong password after a fresh export must reject (not wipe/restore).
    await resetPrivateState('wf-demo-store');
    await expect(importPrivateState('wrong-password-here', 'wf-demo-store', payload)).rejects.toThrow();
    expect(await browserPrivateStateProvider.get('wf-demo')).toBeNull();
  });

  it('resetPrivateState resolves (bridge contract: Promise<void>)', async () => {
    await expect(resetPrivateState('wf-demo-store')).resolves.toBeUndefined();
  });
});

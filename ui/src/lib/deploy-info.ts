import { logError } from './logger';
// On-chain registry facts for the notary strip, sourced from
// packages/contract/deploy-output.json (copied to public/ by copy-keys so the
// UI survives redeploys without a code change). Fetch fails at dev-time are
// expected (fixture tests, cold start) — fall back to the last known values.

export interface DeployNotaryKey {
  id: string;
  x: string;
  y: string;
}

export interface DeployInfo {
  contractAddress: string;
  network: string;
  notaryKeys: DeployNotaryKey[];
}

// Last known values from packages/contract/deploy-output.json (redeployed
// 2026-08-07 with 30-day freshness window; registry re-rotated to the running
// instance keys). Redeploy → copy-keys refreshes public/deploy-output.json →
// these constants only matter offline.
const FALLBACK: DeployInfo = {
  contractAddress: '364a84dd0bc065d7ea25fd45d2072763a1477ee15011e3b5c6bf2c07d04a5ff3',
  network: 'local-devnet',
  notaryKeys: [
    { id: 'notary-1', x: '0x3862022a87a469108254b4530e1455cb016835894834b8c05b181cdf35de5b4f', y: '0x43c040874581a4434744453744aca7c2fac2d04ff9340aa9cfe3f3268b26b365' },
    { id: 'notary-2', x: '0x58da03745fe50613212d2f2ef4f07b5983260f978018d3a308bcc3316e932194', y: '0x6633c8b80640f2b5f3c7d38017af3008a93ce39b190c4025df5d772b9b4a7958' },
    { id: 'notary-3', x: '0x6b58aa88e9c81548a41bad567257e2eeb3cb2b81b2b48082c655f093998b8a59', y: '0x19b59ef0dbf4b2a503d493ec7c29439384b3b38cfb29f0eed8e7ad5388d7747' },
  ],
};

let cached: DeployInfo | null = null;

const normalize = (raw: unknown): DeployInfo | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const keys = obj.notaryInstances ?? obj.notaryPublicKeys;
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const notaryKeys: DeployNotaryKey[] = keys.slice(0, 3).map((k, index) => {
    const entry = k as Record<string, unknown>;
    const pk = (entry.publicKey ?? entry) as Record<string, unknown>;
    const x = typeof pk.x === 'string' ? pk.x : '0x';
    const y = typeof pk.y === 'string' ? pk.y : '0x';
    return { id: typeof entry.id === 'string' ? entry.id : `notary-${index + 1}`, x, y };
  });
  return {
    contractAddress: typeof obj.contractAddress === 'string' ? obj.contractAddress : FALLBACK.contractAddress,
    network: 'local-devnet',
    notaryKeys,
  };
};

export const loadDeployInfo = async (): Promise<DeployInfo> => {
  if (cached) return cached;
  try {
    const res = await fetch('/deploy-output.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = normalize(await res.json());
    if (parsed) cached = parsed;
    return parsed ?? FALLBACK;
  } catch (err) {
    logError('deploy-info.load', err);
    return FALLBACK;
  }
};

export const shortContract = (address: string): string =>
  address.length > 18 ? `${address.slice(0, 10)}…${address.slice(-6)}` : address;

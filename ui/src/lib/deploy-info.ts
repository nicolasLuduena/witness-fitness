// On-chain registry facts for the notary strip, sourced from
// packages/contract/deploy-output.json (copied to public/ by copy-keys so the
// UI survives redeploys without a code change). A missing or malformed file is
// a LOUD error — silently serving a stale hardcoded contract address would
// submit transactions to the wrong chain (no-fallback rule).

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
  if (typeof obj.contractAddress !== 'string' || obj.contractAddress.length === 0) {
    return null;
  }
  return {
    contractAddress: obj.contractAddress,
    network: 'local-devnet',
    notaryKeys,
  };
};

let cached: DeployInfo | null = null;

export const loadDeployInfo = async (): Promise<DeployInfo> => {
  if (cached) return cached;
  const res = await fetch('/deploy-output.json');
  if (!res.ok) {
    throw new Error(
      `deploy-output.json missing (HTTP ${res.status}) — run copy-keys and restart the dev server`
    );
  }
  const parsed = normalize(await res.json());
  if (!parsed) {
    throw new Error('deploy-output.json is malformed — run copy-keys and restart the dev server');
  }
  cached = parsed;
  return parsed;
};

export const shortContract = (address: string): string =>
  address.length > 18 ? `${address.slice(0, 10)}…${address.slice(-6)}` : address;

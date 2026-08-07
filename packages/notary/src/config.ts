// Notary instance configuration. All secrets come from the environment
// (NOTARY_KEY hex, 32 bytes) — never from code or config files in git.

export interface NotaryConfig {
  notaryKey: string;
  notaryId: string;
  port: number;
  attestorUrl: string;
  contractAddress: string;
  nodeUrl: string;
  indexerUrl: string;
  proofServerUrl: string;
  allowedHosts: string[];
  maxBodyBytes: number;
}

export const DEFAULT_ALLOWED_HOSTS = [
  'www.strava.com',
  'api.strava.com',
  'strava.com',
  'api.github.com',
];

export const requireEnv = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (!value) {
    throw new Error(`missing required env var ${name}`);
  }
  return value;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): NotaryConfig => {
  const notaryKey = requireEnv(env, 'NOTARY_KEY');
  const keyBytes = notaryKey.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(keyBytes)) {
    throw new Error('NOTARY_KEY must be a 32-byte hex scalar (64 hex chars, optional 0x prefix)');
  }
  return {
    notaryKey: keyBytes,
    notaryId: requireEnv(env, 'NOTARY_ID'),
    port: Number(env.PORT ?? 8101),
    attestorUrl: env.ATTESTOR_URL ?? 'ws://localhost:8001/ws',
    contractAddress: env.CONTRACT_ADDRESS ?? '',
    nodeUrl: env.NODE_URL ?? 'http://127.0.0.1:9944',
    indexerUrl: env.INDEXER_URL ?? 'http://127.0.0.1:8088/api/v3/graphql',
    proofServerUrl: env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300',
    allowedHosts: (env.ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS.join(','))
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    maxBodyBytes: Number(env.MAX_BODY_BYTES ?? 10_000_000),
  };
};

// Build-time stub for `fs/promises`. The zk-symmetric-crypto file-fetch
// module imports it statically; reading files is meaningless in the browser
// (the local-fetch path is only used by the snarkjs/gnark engines, never by
// stwo). Alias: `fs/promises` → this file (vite.config.ts).
const unavailable = (name: string) => () => {
  throw new Error(`${name} is not available in the browser — local zk-resource file fetching is Node-only (the browser path uses the stwo engine)`);
};

export const readFile = unavailable('fs.readFile');
export const readdir = unavailable('fs.readdir');
export const stat = unavailable('fs.stat');

export default { readFile, readdir, stat };

// Build-time stub for `@reclaimprotocol/zk-symmetric-crypto/gnark`. The
// published entry statically imports the koffi native addon (toprf.js), which
// cannot be browser-bundled. attestor-core imports the two makers statically
// but only INVOKES the one matching zkEngine — the browser path always uses
// 'stwo', so these throw only if someone requests gnark at runtime.
// Alias: `@reclaimprotocol/zk-symmetric-crypto/gnark` → this file.
const unavailable = (name: string) => () => {
  throw new Error(`${name} is not available in the browser — the WitnessFitness browser path uses the stwo ZK engine`);
};

export const makeGnarkZkOperator = unavailable('makeGnarkZkOperator');
export const makeGnarkOPRFOperator = unavailable('makeGnarkOPRFOperator');

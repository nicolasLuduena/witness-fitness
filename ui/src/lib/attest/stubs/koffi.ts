// Build-time stub for the `koffi` native FFI addon. attestor-core statically
// imports the gnark ZK engine chain (`@reclaimprotocol/zk-symmetric-crypto/
// gnark` → koffi), which loads a platform .node binary at module scope — an
// unloadable dependency in the browser bundle. The browser path uses the stwo
// engine only, so koffi is never CALLED; the stub exists to satisfy the
// import graph. Alias: `koffi` → this file (vite.config.ts).
const unavailable = (name: string) => () => {
  throw new Error(`${name} is not available in the browser — the WitnessFitness browser path uses the stwo ZK engine and never calls it`);
};

export const load = unavailable('koffi.load');
export const probe = unavailable('koffi.probe');
export default { load: unavailable('koffi.load'), probe: unavailable('koffi.probe') };

// Build-time stub for the `re2` native regex addon (attestor-core optional
// dependency — loads build/Release/re2.node at module scope, unloadable in
// the browser bundle). Constructable so `new RE2(...)` compiles; the browser
// path never constructs it. Alias: `re2` → this file (vite.config.ts).
export default class Re2Stub {
  constructor() {
    throw new Error('re2 is not available in the browser — not needed on the WitnessFitness browser path');
  }
}

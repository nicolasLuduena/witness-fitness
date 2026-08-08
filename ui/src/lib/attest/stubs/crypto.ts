// Browser-safe `crypto` module shim (vite alias target).
// @reclaimprotocol/tls/lib/crypto/webcrypto.js does
// `import { webcrypto } from 'crypto'` at module scope and reads
// `.subtle` immediately — in the browser, the node `crypto` shim has no
// `subtle`, crashing the page at load ("Cannot read properties of
// undefined (reading 'subtle')", DemoStore refresh). Aliasing `crypto` to
// this file makes that import resolve to the browser's real WebCrypto.
// Requires a secure context (localhost/127.0.0.1) for crypto.subtle.
export const webcrypto = globalThis.crypto;
export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};
export default globalThis.crypto;

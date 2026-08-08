import path from 'path';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait(), nodePolyfills({ exclude: ['crypto'] })],
  resolve: {
    alias: {
      'vite-plugin-node-polyfills/shims/buffer': path.resolve(
        __dirname,
        './node_modules/vite-plugin-node-polyfills/shims/buffer/dist/index.js'
      ),
      'vite-plugin-node-polyfills/shims/process': path.resolve(
        __dirname,
        './node_modules/vite-plugin-node-polyfills/shims/process/dist/index.js'
      ),
      'vite-plugin-node-polyfills/shims/global': path.resolve(
        __dirname,
        './node_modules/vite-plugin-node-polyfills/shims/global/dist/index.js'
      ),
      // Round 1C browser-attestation aliases (validated in /tmp/opencode/
      // browser-test): attestor-core's bundle statically imports Node-only
      // chains that cannot be browser-bundled. koffi/re2 load native .node
      // binaries, fs/promises is the file-fetch path (snarkjs/gnark only),
      // and the published `./stwo` entry uses createRequire + fs at module
      // scope. The stwo alias points at the vendored wasm-bindgen WEB build
      // (same circuit set, browser-safe — see ui/src/lib/attest/stwo-browser.ts).
      koffi: path.resolve(__dirname, './src/lib/attest/stubs/koffi.ts'),
      // @reclaimprotocol/tls/lib/crypto/webcrypto.js imports { webcrypto }
      // from 'crypto' and reads .subtle at module scope — the node crypto
      // shim has no subtle, crashing the page at load. Alias to the
      // browser's real WebCrypto (secure context required).
      crypto: path.resolve(__dirname, './src/lib/attest/stubs/crypto.ts'),
      re2: path.resolve(__dirname, './src/lib/attest/stubs/re2.ts'),
      'fs/promises': path.resolve(__dirname, './src/lib/attest/stubs/fs-promises.ts'),
      '@reclaimprotocol/zk-symmetric-crypto/gnark': path.resolve(
        __dirname,
        './src/lib/attest/stubs/gnark.ts'
      ),
      '@reclaimprotocol/zk-symmetric-crypto/stwo': path.resolve(
        __dirname,
        './src/lib/attest/stwo-browser.ts'
      ),
    },
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.wasm'],
    mainFields: ['browser', 'module', 'main'],
  },
  build: {
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true,
      extensions: ['.js', '.cjs'],
      ignoreDynamicRequires: true,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
      supported: { 'top-level-await': true },
      platform: 'browser',
      format: 'esm',
      loader: {
        '.wasm': 'binary',
      },
    },
    include: ['@midnight-ntwrk/compact-runtime'],
    // Dev pre-bundling (esbuild) resolves bare `crypto` differently than the
    // build's alias — exclude the reclaim stack so dev serves its source
    // through the vite resolver (alias applies), matching build behavior.
    exclude: [
      '@reclaimprotocol/attestor-core',
      '@reclaimprotocol/tls',
      '@reclaimprotocol/zk-symmetric-crypto',
    ],
  },
});

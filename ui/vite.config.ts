import path from 'path';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait(), nodePolyfills()],
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
  },
});

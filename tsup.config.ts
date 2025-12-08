import { defineConfig } from 'tsup';

export default defineConfig([
  // Browser-only bundle: no splitting to avoid sharing chunks with Node/MCP deps
  {
    entry: ['src/browser.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    splitting: false,
    shims: false,
    minify: false,
  },
  // Main entry (Node-compatible)
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2020',
  },
  // MCP CLI (Node only)
  {
    entry: { 'mcp/cli': 'src/mcp/cli.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'es2020',
    splitting: false,
    shims: false,
    minify: false,
  },
]);

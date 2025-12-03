import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
  },
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

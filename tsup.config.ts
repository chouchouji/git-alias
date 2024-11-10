import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  external: ['vscode'],
  noExternal: ['rattail'],
  splitting: false,
  clean: true,
  format: ['cjs'],
  outDir: 'dist',
  sourcemap: true,
  minify: true,
});
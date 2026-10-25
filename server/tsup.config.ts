import { defineConfig } from 'tsup';

// The shared workspace package is TypeScript source, so it is bundled into the server build.
export default defineConfig({
  entry: ['src/server.ts', 'src/seed/run.ts', 'src/migrations/run.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  noExternal: ['@hms/shared'],
});

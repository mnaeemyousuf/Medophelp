import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-clock.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      TZ: 'Asia/Karachi',
      // Separate database on the local dev replica set (npm run db:start). Dropped and re-seeded per run.
      MONGODB_URI: process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27018/hms_test?replicaSet=rs0',
      JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-0123456789',
      CORS_ORIGINS: 'http://localhost:5173',
      FILE_STORAGE_DIR: './.test-storage',
      SEED_DEMO_PASSWORD: 'Test@Pass12345',
    },
  },
});

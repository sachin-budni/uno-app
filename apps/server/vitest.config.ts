import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    // Keep the suite output readable; the server is chatty by design.
    env: { LOG_LEVEL: 'error', NODE_ENV: 'test' },
    coverage: {
      provider: 'v8',
      include: ['src/game/**/*.ts', 'src/services/**/*.ts'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});

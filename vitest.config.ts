import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [], // Add setup files here if needed
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
  },
});

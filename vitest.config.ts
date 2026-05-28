/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        'e2e/**',
        '**/*.config.*',
        '**/test/**',
        '**/types/**',
        'src/main.tsx',
        'src/App.tsx',
        'server/index.ts',
      ],
      thresholds: {
        'server/domain/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
        'server/lib/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
        'cli/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
        'src/hooks/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
        'src/stores/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
        'src/lib/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'frontend',
          environment: 'jsdom',
          environmentOptions: {
            jsdom: {
              url: 'http://localhost/',
            },
          },
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'backend',
          environment: 'node',
          include: ['server/**/*.{test,spec}.ts', 'cli/**/*.{test,spec}.ts'],
          setupFiles: ['server/test/setup.ts'],
        },
      },
    ],
  },
});

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx,js}'],
    exclude: [
      'tests/e2e/**',
      'tests/compliance.test.ts',
      'tests/linz.test.ts',
      'tests/bob-video-automation.test.ts',
      'playwright-report/**',
      'test-results/**',
    ],
    setupFiles: ['./src/test-setup.ts'],
  },
})

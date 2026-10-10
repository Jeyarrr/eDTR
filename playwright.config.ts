import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    channel: 'msedge',
    trace: 'retain-on-failure',
  },
  reporter: 'list',
  workers: 1,
});

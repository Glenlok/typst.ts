import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: 'tests',
  grepInvert: /@tar/,
  webServer: {
    command: 'corepack yarn build && vite --config tests/vite.config.ts --host 127.0.0.1',
    port: 5173,
  },
});

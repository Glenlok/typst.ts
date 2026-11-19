import { defineConfig } from 'playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  grepInvert: undefined,
  grep: /@tar/,
  globalSetup: './tests/setup.ts',
});

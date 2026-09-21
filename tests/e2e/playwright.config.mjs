import { defineConfig } from './runtime.mjs';
import path from 'node:path';

const output = process.env.AUDIT_RUN_DIR;
if (!output) throw new Error('Set AUDIT_RUN_DIR to a new project artifacts directory.');
export default defineConfig({
  testDir: '.', testMatch: '*.spec.mjs', workers: 1, retries: 0,
  timeout: 45000, expect: { timeout: 4000 },
  outputDir: path.join(output, 'test-results'),
  reporter: [['list'], ['json', { outputFile: path.join(output, 'playwright.json') }]],
  use: { headless: !process.env.AUDIT_HEADED, launchOptions: process.env.AUDIT_HEADED ? { slowMo: 300 } : {}, baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 90_000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173/procedural-paper/', headless: true, viewport: { width: 1440, height: 1000 }, launchOptions: { ...(process.env.PLAYWRIGHT_CHROME ? { executablePath: process.env.PLAYWRIGHT_CHROME } : {}), args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'DEMO_BASE=/procedural-paper/ pnpm --filter demo build && DEMO_BASE=/procedural-paper/ pnpm --filter demo preview --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173/procedural-paper/', reuseExistingServer: false, timeout: 120_000 },
});

import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const shouldStartServer = !process.env.E2E_BASE_URL;

export default defineConfig({
	testDir: 'e2e',
	timeout: 60_000,
	expect: {
		timeout: 10_000
	},
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	use: {
		baseURL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	webServer: shouldStartServer
		? {
				command: 'npm run dev -- --host 127.0.0.1 --port 5173',
				url: baseURL,
				reuseExistingServer: !process.env.CI,
				timeout: 120_000
			}
		: undefined
});

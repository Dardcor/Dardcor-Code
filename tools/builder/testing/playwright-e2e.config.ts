/**
 * Dardcor Code - Playwright E2E Browser & Desktop UI Test Suite Config (Task 911)
 *
 * Playwright config WITHOUT importing '@playwright/test' (that package is
 * not in devDependencies). The config object is typed with local structural
 * types and is compatible with Playwright's config loader. Projects cover
 * browser targets; set E2E_BASE_URL to point at the built workbench.
 */

interface PlaywrightTestProject {
	readonly name: string;
	readonly use: Record<string, unknown>;
}

interface PlaywrightConfig {
	readonly testDir: string;
	readonly testMatch: string[];
	readonly timeout: number;
	readonly expect: { timeout: number };
	readonly fullyParallel: boolean;
	readonly forbidOnly: boolean;
	readonly retries: number;
	readonly workers: number;
	readonly reporter: Array<string | [string, unknown]>;
	readonly use: Record<string, unknown>;
	readonly projects: PlaywrightTestProject[];
}

const e2eBaseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

const config: PlaywrightConfig = {
	testDir: './e2e-tests',
	testMatch: ['**/*.spec.ts'],
	timeout: 30_000,
	expect: {
		timeout: 10_000,
	},
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 2,
	reporter: ['list', ['html', { open: 'never' }]],
	use: {
		baseURL: e2eBaseUrl,
		headless: true,
		viewport: { width: 1440, height: 900 },
		ignoreHTTPSErrors: true,
		video: 'retain-on-failure',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { browserName: 'chromium', launchOptions: { args: ['--no-sandbox'] } },
		},
		{
			name: 'firefox',
			use: { browserName: 'firefox' },
		},
		{
			name: 'webkit',
			use: { browserName: 'webkit' },
		},
	],
};

export default config;

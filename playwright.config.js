const { defineConfig } = require('@playwright/test');

// Electron only — no browsers are downloaded or launched, so there is no
// `projects` list and no `npx playwright install` step anywhere.
module.exports = defineConfig({
	testDir: 'e2e',
	// Launching a packaged Electron app is not safe to parallelise: every worker
	// would share the same userData directory.
	workers: 1,
	fullyParallel: false,
	retries: 1,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		trace: 'retain-on-failure',
	},
});

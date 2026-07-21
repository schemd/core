import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests/visual',
	outputDir: './test-results',
	fullyParallel: false,
	workers: 1,
	reporter: 'line',
	snapshotPathTemplate: '{testDir}/goldens/{arg}{ext}',
	use: {
		browserName: 'chromium',
		deviceScaleFactor: 1,
		headless: true,
		viewport: { width: 1100, height: 760 }
	},
	expect: {
		toHaveScreenshot: {
			animations: 'disabled',
			caret: 'hide',
			scale: 'css',
			threshold: 0.2
		}
	}
});

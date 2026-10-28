import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  outputDir: './output/test-results',
  // One retry, so the flaky test passes on its second attempt and the failing
  // test shows two attempts.
  retries: 1,
  reporter: [
    ['list'],
    [
      // The built reporter. Playwright resolves reporter names from the
      // project's node_modules, which a package cannot do for itself; the
      // pack check installs the tarball and uses the package name.
      '../dist/index.js',
      {
        title: 'Example shop',
        outputFolder: './output/report',
        theme: 'example',
        issueUrl: 'https://issues.example.com/{key}',
      },
    ],
  ],
  // Fixed run details, so the report shows the same ones locally and in CI.
  captureGitInfo: { commit: false, diff: false },
  metadata: {
    targetEnv: 'staging',
    ciRun: 'https://ci.example.com/runs/42',
    gitCommit: {
      hash: '0123456789abcdef0123456789abcdef01234567',
      subject: 'Add the newsletter',
      branch: 'main',
      author: { name: 'Sam Example' },
    },
  },
  use: { baseURL: 'http://127.0.0.1:4789' },
  webServer: {
    command: 'node server.mjs',
    url: 'http://127.0.0.1:4789/api/health',
    reuseExistingServer: false,
  },
  projects: [
    // Every spec outside ui/: the API, Contract and Other levels.
    { name: 'api', testIgnore: 'ui/**' },
    // UI specs run in two projects, so their test pages have a tab for each.
    // Both are Chromium, which is the only browser CI installs.
    {
      name: 'chromium',
      testMatch: 'ui/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        screenshot: 'on',
        video: 'on',
        trace: 'on',
      },
    },
    {
      name: 'mobile-chrome',
      testMatch: 'ui/**/*.spec.ts',
      use: {
        ...devices['Pixel 7'],
        screenshot: 'on',
        video: 'on',
        trace: 'on',
      },
    },
  ],
});

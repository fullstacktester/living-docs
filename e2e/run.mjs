// End-to-end check: runs the example suite through the built reporter, checks
// the report's data, then serves it with `living-docs serve` and checks the
// page renders it, in a browser.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const e2e = new URL('.', import.meta.url);
const run = spawnSync(
  'npx',
  ['playwright', 'test', '-c', 'playwright.config.ts', '--shuffle', '4242'],
  {
    cwd: e2e,
    stdio: 'inherit',
  },
);
// One test fails on purpose, so the run does too.
assert.equal(run.status, 1, 'the example suite fails only as expected');

const html = fs.readFileSync(new URL('output/report/index.html', e2e), 'utf8');
const json = html.match(
  /<script type="application\/json" id="report-data">(.*?)<\/script>/s,
)?.[1];
assert.ok(json, 'the report embeds its data');
const data = JSON.parse(json);

const walk = (nodes, out = []) => {
  for (const n of nodes) {
    out.push(n);
    walk(n.children, out);
  }
  return out;
};
const byTitle = (title) => data.scenarios.find((s) => s.title === title);
const runOf = (scenario, project) =>
  scenario.runs.find((r) => r.project === project);
const lastAttempt = (r) => r.attempts.at(-1);

// ------------------------------------------------------------ the outcomes

const RIGHT = 'a shopper with the right password gets a session';
const WRONG = 'a shopper with a wrong password is told why';
const RETRY = 'the session is found on retry';
const PASSKEY = 'a shopper signs in with a passkey';
const BUY = 'a shopper buys a kettle';
const SUBSCRIBE = 'a shopper subscribes to the newsletter';

// Every test, so an unexpected failure anywhere fails the check.
assert.deepEqual(
  Object.fromEntries(data.scenarios.map((s) => [s.title, s.status])),
  {
    [RIGHT]: 'passed',
    [WRONG]: 'failed',
    [RETRY]: 'flaky',
    [PASSKEY]: 'skipped',
    'lists orders': 'passed',
    'places an order': 'passed',
    'an order has an id and an item': 'passed',
    'the shop is up': 'passed',
    [SUBSCRIBE]: 'passed',
    [BUY]: 'passed',
  },
  'every test has the outcome it was written for',
);
assert.equal(data.runStatus, 'failed');

const wrong = runOf(byTitle(WRONG), 'api');
assert.deepEqual(
  wrong.attempts.map((a) => [a.retry, a.status]),
  [
    [0, 'failed'],
    [1, 'failed'],
  ],
  'a failing test keeps every attempt',
);
const failedStep = walk(lastAttempt(wrong).steps).find(
  (n) => n.kind === 'assertion' && n.failed,
);
assert.equal(failedStep.title, 'the reason is given');
assert.match(failedStep.error.message, /wrong password/);
assert.ok(failedStep.error.snippet, 'the error carries its code snippet');
assert.deepEqual(
  lastAttempt(wrong)
    .steps.filter((n) => n.failed)
    .map((n) => n.title),
  ['sign in'],
  'the failure is marked up the path to the top step',
);

const retry = runOf(byTitle(RETRY), 'api');
assert.deepEqual(
  retry.attempts.map((a) => a.status),
  ['failed', 'passed'],
  'a flaky test passes on its retry',
);

// --------------------------------------------------- levels and features

assert.deepEqual(data.levels, ['API', 'Contract', 'Other', 'UI']);
assert.deepEqual(data.features, [
  'Account',
  'Health',
  'Orders',
  'Orders schema',
]);
assert.deepEqual(data.projects, ['api', 'chromium', 'mobile-chrome']);
const placed = (title) => {
  const { level, feature, spec } = byTitle(title);
  return { level, feature, spec };
};
assert.deepEqual(
  placed('lists orders'),
  { level: 'API', feature: 'Orders', spec: 'Orders' },
  'the folder under the level is the feature, the file is the spec',
);
assert.deepEqual(
  placed(SUBSCRIBE),
  { level: 'UI', feature: 'Account', spec: 'Newsletter' },
  'a feature holds specs at every level',
);
assert.deepEqual(
  placed('an order has an id and an item'),
  { level: 'Contract', feature: 'Orders schema', spec: 'Orders schema' },
  'a long level name is humanised; a spec in a level folder is its own feature',
);
assert.deepEqual(
  placed('the shop is up'),
  { level: 'Other', feature: 'Health', spec: 'Health' },
  'a spec straight in testDir is level Other',
);
assert.deepEqual(byTitle(RIGHT).describePath, ['signing in']);

// --------------------------------------------- narratives, tags and issues

const list = byTitle('lists orders');
assert.equal(list.narrative, 'A shopper can see the orders they have placed.');
assert.deepEqual(list.issues, ['SHOP-1']);
assert.deepEqual(list.tags, ['@smoke']);
const right = byTitle(RIGHT);
assert.deepEqual(right.tags, ['@smoke', '@account']);
assert.deepEqual(right.issues, [
  'SHOP-7',
  'https://tracker.example.com/browse/SHOP-8',
  'Raised in the sprint review',
]);
assert.equal(
  walk(lastAttempt(runOf(right, 'api')).steps).find(
    (n) => n.title === 'with a one-time code',
  )?.kind,
  'step',
  'steps nest three deep',
);

// ------------------------------------------------------------ run details

assert.equal(data.logo?.alt, 'Example Shop', "the theme's logo is embedded");
assert.match(data.logo.srcDark, /^data:image\/svg/, 'and its dark logo');
assert.equal(data.shuffleSeed, '4242', 'the shuffle seed is recorded');
assert.ok(
  !('shuffleSeed' in data.metadata),
  'the seed is not repeated in the metadata',
);
assert.equal(data.metadata.targetEnv, 'staging');
assert.equal(data.metadata.ciRun, 'https://ci.example.com/runs/42');
assert.deepEqual(data.git, {
  hash: '0123456789abcdef0123456789abcdef01234567',
  subject: 'Add the newsletter',
  branch: 'main',
  author: 'Sam Example',
});

// -------------------------------------------------------------- API calls

const listCall = walk(lastAttempt(list.runs[0]).steps).find(
  (n) => n.kind === 'api',
);
assert.equal(listCall.api.source, 'test');
assert.equal(
  listCall.api.request.headers['x-shop-secret'],
  '[redacted]',
  'extra header redacted',
);

const place = byTitle('places an order');
const sendStep = lastAttempt(place.runs[0]).steps.find(
  (n) => n.title === 'send the order',
);
const placeCall = sendStep.children.find((n) => n.kind === 'api');
assert.equal(
  placeCall.api.request.body.password,
  '[redacted]',
  'default key redacted',
);

const signIn = walk(lastAttempt(runOf(right, 'api')).steps).find((n) =>
  n.api?.url.endsWith('/api/sign-in'),
);
assert.equal(signIn.api.request.body.otp, '[redacted]', 'request key redacted');
assert.equal(signIn.api.response.body.otp, '123456', 'but not in the response');
assert.equal(signIn.api.response.body.token, '[redacted]');

for (const project of ['chromium', 'mobile-chrome']) {
  const buy = runOf(byTitle(BUY), project);
  const steps = lastAttempt(buy).steps;
  assert.ok(
    !steps.some((n) => n.api?.source === 'browser'),
    `${project}: no browser call at the top level`,
  );
  const buyStep = steps.find((n) => n.title === 'buy');
  const browserCall = walk(buyStep.children).find(
    (n) => n.api?.source === 'browser',
  );
  assert.ok(browserCall, 'the browser call sits under the step that made it');
  assert.equal(browserCall.api.request.body.password, '[redacted]');
  assert.equal(browserCall.api.response.headers['set-cookie'], '[redacted]');
  assert.deepEqual(
    lastAttempt(buy)
      .evidence.map((e) => e.kind)
      .sort(),
    ['image', 'trace', 'video'],
    `${project}: screenshot, video and trace are evidence`,
  );
  for (const e of lastAttempt(buy).evidence)
    assert.ok(
      fs.existsSync(new URL(`output/report/${e.href}`, e2e)),
      `${e.href} is copied into the report`,
    );

  const subscribe = lastAttempt(runOf(byTitle(SUBSCRIBE), project)).steps;
  const [openStep, subscribeStep] = subscribe;
  const stock = openStep.children.find((n) => n.api?.url.endsWith('/stock'));
  assert.ok(stock, `${project}: a call with no response sits under its step`);
  assert.ok(stock.api.error && !stock.api.response, 'and records the error');
  const form = subscribeStep.children.find((n) =>
    n.api?.url.endsWith('/api/newsletter'),
  );
  assert.equal(form.api.method, 'POST', 'a form post is recorded');
  assert.deepEqual(form.api.request.body, {
    email: 'sam@example.com',
    token: '[redacted]',
  });
  assert.equal(
    subscribeStep.children.find((n) => n.kind === 'attachment')?.evidence.text,
    'sam@example.com',
    'an attachment made in a step shows in the step',
  );
}

// ------------------------------------------------------------------ serve

// The bin: start it, read the URL it prints.
const cli = spawn(
  process.execPath,
  [
    new URL('../dist/cli.js', import.meta.url).pathname,
    'serve',
    'output/report',
    '--port',
    '0',
  ],
  {
    cwd: e2e,
  },
);
const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error('serve printed no URL')),
    10_000,
  );
  cli.stdout.on('data', (chunk) => {
    const found = String(chunk).match(/http:\/\/\S+\//);
    if (found) {
      clearTimeout(timer);
      resolve(found[0]);
    }
  });
  cli.on('exit', (code) => reject(new Error(`serve exited with ${code}`)));
});
const served = await fetch(url);
assert.equal(served.status, 200);
assert.ok(
  (await served.text()).includes('Example shop'),
  'serve returns the report',
);

// ------------------------------------------------------- the rendered page

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
  const main = page.locator('main');
  const open = (route) => page.goto(`${url}#/${route}`);
  const testRoute = (title) => `test/${byTitle(title).id}`;
  // The innermost step item whose own row holds the text: its ancestors match
  // too, and come first.
  const stepItem = (text) =>
    main
      .locator('li', { has: page.locator('.step-row', { hasText: text }) })
      .last();

  // Overview
  await open('');
  await expect(page.locator('header h1')).toHaveText('Example shop');
  await expect(page.getByRole('img', { name: 'Example Shop' })).toBeVisible();
  await expect(page.locator('header picture source')).toHaveCount(1);
  await expect(page.locator('header')).toContainText('Shuffled, seed 4242');
  await expect(page.locator('header')).toContainText('Environment staging');
  await expect(page.locator('header')).toContainText('Branch main');
  await expect(page.locator('header')).toContainText('Commit 01234567');
  const kpi = (label) =>
    page.locator('.kpi').filter({ hasText: label }).locator('.value');
  await expect(kpi('Tests')).toHaveText('10');
  await expect(kpi('Passed')).toHaveText('7');
  await expect(kpi('Failed')).toHaveText('1');
  await expect(kpi('Flaky')).toHaveText('1');
  await expect(kpi('Skipped')).toHaveText('1');
  await expect(page.locator('.donut')).toBeVisible();
  const details = page.locator('section').filter({ hasText: 'Run details' });
  await expect(details).toContainText('staging');
  await expect(details).toContainText('Add the newsletter');
  await expect(details.getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    'https://ci.example.com/runs/42',
  );
  const failures = page.locator('section').filter({ hasText: 'Failures (2)' });
  await expect(failures.getByRole('link')).toHaveText([WRONG, RETRY]);
  await expect(failures).toContainText('wrong password');
  await expect(failures).toContainText('signing in ›');
  await expect(
    page.locator('section').filter({ hasText: 'Slowest tests' }).locator('li'),
  ).toHaveCount(5);
  await expect(
    page.locator('a.card').filter({ hasText: 'Contract tests' }),
  ).toBeVisible();
  await expect(
    page
      .locator('section')
      .filter({ hasText: 'By feature' })
      .locator('tbody tr'),
  ).toHaveCount(4);

  // The nav: one entry per level.
  await expect(page.getByRole('navigation').getByRole('link')).toHaveText([
    'Overview',
    'Features',
    'API tests',
    'Contract tests',
    'Other tests',
    'UI tests',
    'All tests',
  ]);

  // Features, and a feature with specs at two levels.
  await page.getByRole('link', { name: 'Features', exact: true }).click();
  await expect(main.locator('tbody tr')).toHaveCount(4);
  await main.getByRole('link', { name: 'Account' }).click();
  await expect(main.locator('h2')).toHaveText('Account');
  await expect(main.locator('.group-section h3')).toHaveText([
    'Sign in API',
    'Newsletter UI',
  ]);
  await expect(main.locator('.describe-row')).toHaveText('signing in');
  await expect(main.locator('tr.in-describe')).toHaveCount(4);

  // A level page groups its tests by feature.
  await open('level/UI');
  await expect(main.locator('h2')).toHaveText('UI tests');
  await expect(main.locator('.group-section h3')).toHaveText([
    'Account',
    'Orders',
  ]);
  await expect(
    main.locator('tr').filter({ hasText: BUY }).locator('.badge'),
  ).toHaveText(['chromium', 'mobile-chrome']);

  // All tests: filter by status, by level and by search.
  await open('tests');
  await expect(main.locator('h2')).toHaveText('All tests (10 of 10)');
  const seg = (group, name) =>
    main.getByRole('group', { name: group }).getByRole('button', { name });
  await seg('Status', 'Failed').click();
  await expect(main.locator('h2')).toHaveText('All tests (1 of 10)');
  await expect(main.locator('tbody .title-cell')).toHaveText([WRONG]);
  await seg('Status', 'Skipped').click();
  await expect(main.locator('tbody .title-cell')).toHaveText([PASSKEY]);
  await seg('Status', 'All').click();
  await seg('Level', 'Contract').click();
  await expect(main.locator('h2')).toHaveText('All tests (1 of 10)');
  await seg('Level', 'All levels').click();
  await main.getByRole('searchbox', { name: 'Search tests' }).fill('@account');
  await expect(main.locator('h2')).toHaveText('All tests (2 of 10)');
  await expect(main.getByRole('searchbox')).toBeFocused();

  // A failed test: the failure path starts open at the error, and each
  // attempt can be shown.
  await open(testRoute(WRONG));
  await expect(main.locator('h1')).toHaveText(WRONG);
  await expect(main.locator('.describe-eyebrow')).toHaveText('signing in');
  await expect(main.locator('.narrative')).toHaveText(
    'A refused sign-in says what was wrong. Fails on purpose.',
  );
  await expect(main.locator('.breadcrumb')).toHaveText('Account › Sign in');
  const attempts = main.getByRole('group', { name: 'Attempt' });
  await expect(attempts.getByRole('button')).toHaveText([
    'First run',
    'Retry 1',
  ]);
  await expect(
    attempts.getByRole('button', { name: 'Retry 1' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const failedRow = main.locator('.step-row.failed', {
    hasText: 'the reason is given',
  });
  await expect(failedRow).toBeVisible();
  await expect(main.locator('.step-extra:not([hidden]) .error')).toContainText(
    'wrong password',
  );
  await expect(main.locator('.step-extra .where')).toContainText(
    'sign-in.spec.ts',
  );
  await attempts.getByRole('button', { name: 'First run' }).click();
  await expect(failedRow).toBeVisible();
  // The 401 call opens to its request and response.
  const call = stepItem('POST /api/sign-in → 401');
  await call.getByRole('button', { name: 'Request / response' }).click();
  await expect(call.locator('.api-origin')).toHaveText(
    'Test API call: made by the test itself.',
  );
  await expect(call.locator('.http-status.bad')).toHaveText('401 Unauthorized');
  await expect(call.locator('pre.code')).toContainText(
    '"password": "[redacted]"',
  );
  await call.getByRole('tab', { name: 'Response' }).click();
  await expect(call.locator('pre.code')).toContainText(
    '"error": "bad password"',
  );

  // A passed test: issues link as a key, a URL and plain text; steps start
  // closed and open to any depth.
  await open(testRoute(RIGHT));
  const issues = main.locator('.chips', { hasText: 'Issues:' });
  await expect(issues.getByRole('link', { name: 'SHOP-7' })).toHaveAttribute(
    'href',
    'https://issues.example.com/SHOP-7',
  );
  await expect(
    issues.getByRole('link', { name: /tracker\.example\.com/ }),
  ).toHaveAttribute('href', 'https://tracker.example.com/browse/SHOP-8');
  await expect(
    issues.locator('span', { hasText: 'Raised in the sprint review' }),
  ).toBeVisible();
  await expect(main.locator('.badge.tag')).toHaveText(['@smoke', '@account']);
  const deepest = main.locator('.step-row', {
    hasText: 'with a one-time code',
  });
  await expect(deepest).toBeHidden();
  await main.getByRole('button', { name: 'Expand all' }).click();
  await expect(deepest).toBeVisible();
  await main.getByRole('button', { name: 'Collapse all' }).click();
  await expect(deepest).toBeHidden();
  await main.getByRole('button', { name: 'Show substeps of sign in' }).click();
  await main
    .getByRole('button', { name: 'Show substeps of send the credentials' })
    .click();
  await expect(deepest).toBeVisible();

  // A flaky test shows its retry passing; a skipped test has no steps.
  await open(testRoute(RETRY));
  await expect(main.locator('.badge.flaky')).toHaveText('Flaky');
  await expect(
    main.getByRole('group', { name: 'Attempt' }).getByRole('button'),
  ).toHaveText(['First run', 'Retry 1']);
  await open(testRoute(PASSKEY));
  await expect(main.locator('.badge.skipped')).toHaveText('Skipped');
  await expect(main).toContainText('No steps recorded.');

  // A UI test: a tab per project, evidence, and browser calls.
  await open(testRoute(BUY));
  const tabs = main.getByRole('tablist', { name: 'Projects' });
  // Each tab starts with its status glyph.
  await expect(tabs.getByRole('tab')).toHaveText([
    /chromium$/,
    /mobile-chrome$/,
  ]);
  await tabs.getByRole('tab', { name: 'mobile-chrome' }).click();
  await expect(
    tabs.getByRole('tab', { name: 'mobile-chrome' }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(main.locator('.steps-head')).toContainText('1 browser API call');
  const evidence = main.locator('.evidence');
  await expect(evidence.getByRole('img', { name: 'screenshot' })).toBeVisible();
  await expect(evidence.locator('video')).toHaveCount(1);
  const viewer = evidence.getByRole('link', { name: 'Open in trace viewer' });
  await expect(viewer).toHaveAttribute(
    'href',
    /^https:\/\/trace\.playwright\.dev\/\?trace=http/,
  );
  const traceHref = await evidence
    .getByRole('link', { name: 'Download trace' })
    .getAttribute('href');
  const trace = await fetch(new URL(traceHref, url));
  assert.equal(trace.status, 200, 'serve returns the trace');
  assert.equal(
    trace.headers.get('access-control-allow-origin'),
    '*',
    'the trace viewer can fetch it',
  );
  await main.getByRole('button', { name: 'Expand all' }).click();
  const browserCall = stepItem('POST /api/orders → 201');
  await expect(browserCall.locator('.step-kind').first()).toHaveText(
    'Browser API',
  );
  await browserCall.getByRole('button', { name: 'Request / response' }).click();
  await expect(browserCall.locator('.api-panel.browser')).toBeVisible();
  await browserCall.getByRole('tab', { name: 'Response' }).click();
  await expect(browserCall.locator('.api-panel')).toContainText(
    'set-cookie[redacted]',
  );

  // A call with no response, and an attachment made in a step.
  await open(testRoute(SUBSCRIBE));
  await main.getByRole('button', { name: 'Expand all' }).click();
  const stock = stepItem('GET /api/stock → no response');
  await stock.getByRole('button', { name: 'Request / response' }).click();
  await expect(stock.locator('.error')).toContainText('net::');
  await stock.getByRole('tab', { name: 'Response' }).click();
  await expect(stock).toContainText('No response recorded.');
  const subscriber = stepItem('subscriber');
  await subscriber.getByRole('button', { name: 'View' }).click();
  await expect(subscriber.locator('details summary')).toContainText(
    'subscriber',
  );

  // From file:// the trace can only be downloaded.
  await page.goto(
    `${new URL('output/report/index.html', e2e).href}#/${testRoute(BUY)}`,
  );
  await expect(main.getByRole('link', { name: 'Download trace' })).toHaveCount(
    1,
  );
  await expect(
    main.getByRole('link', { name: 'Open in trace viewer' }),
  ).toHaveCount(0);
  await expect(main).toContainText('npx playwright show-trace');

  assert.deepEqual(pageErrors, [], 'the page logs no errors');
} finally {
  await browser.close();
  cli.kill('SIGTERM');
}

console.log('\ne2e: all report, serve and page checks passed');

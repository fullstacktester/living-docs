// Packs the package, installs the tarball into a fresh project and runs a test
// there with the reporter referenced by name, as a consumer would. Catches a
// file missing from `files` or a broken `exports` entry, which never show up
// inside this repository.
//
// PLAYWRIGHT_VERSION picks the Playwright the consumer installs (default: the
// one this repository develops with), so CI can run the oldest the peer range
// claims.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const work = path.join(root, '.pack-check');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'specs', 'api', 'checkout'), { recursive: true });

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packed = JSON.parse(
  execFileSync(npm, ['pack', '--json', '--pack-destination', work], {
    cwd: root,
    encoding: 'utf8',
  }),
)[0];
const files = packed.files.map((f) => f.path);
for (const expected of [
  'dist/index.js',
  'dist/cli.js',
  'dist/client/app.js',
  'dist/client/styles.css',
  'dist/record/index.js',
  'dist/annotations.js',
  'themes/default.theme.json',
  'themes/theme.schema.json',
  'LICENSE',
  'README.md',
]) {
  assert.ok(files.includes(expected), `the tarball holds ${expected}`);
}
assert.ok(
  !files.some(
    (f) =>
      f.startsWith('src/') || f.startsWith('test/') || f.startsWith('e2e/'),
  ),
  'no source or tests in the tarball',
);
console.log(
  `packed ${packed.filename}: ${files.length} files, ${packed.size} bytes`,
);

const devDependencies = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
).devDependencies;
const playwright =
  process.env.PLAYWRIGHT_VERSION || devDependencies['@playwright/test'];
console.log(`consumer: Playwright ${playwright}`);
fs.writeFileSync(
  path.join(work, 'package.json'),
  JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
);
execFileSync(
  npm,
  [
    'install',
    '--no-audit',
    '--no-fund',
    `./${packed.filename}`,
    `@playwright/test@${playwright}`,
    `typescript@${devDependencies.typescript}`,
    `@types/node@${devDependencies['@types/node']}`,
  ],
  { cwd: work, stdio: 'inherit' },
);

fs.writeFileSync(
  path.join(work, 'playwright.config.ts'),
  `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './specs',
  reporter: [['@fullstacktester/living-docs', { outputFolder: './report', title: 'Consumer', theme: 'brand' }]],
});
`,
);
// A theme pointing at the schema by the path the README gives.
const schemaPath =
  './node_modules/@fullstacktester/living-docs/themes/theme.schema.json';
assert.ok(
  fs.existsSync(path.join(work, schemaPath)),
  'the schema is where the README says',
);
fs.writeFileSync(
  path.join(work, 'brand.theme.json'),
  JSON.stringify({ $schema: schemaPath, light: { accent: '#123456' } }),
);
fs.writeFileSync(
  path.join(work, 'specs', 'api', 'checkout', 'basket.spec.ts'),
  `import http from 'node:http';
import { test as base, expect } from '@playwright/test';
import { about } from '@fullstacktester/living-docs/annotations';
import { withApiAttachments } from '@fullstacktester/living-docs/record';

// No browser: this runs on any Playwright in the peer range without one.
const test = base.extend({
  request: async ({ request }, use, testInfo) => {
    await use(withApiAttachments(request, testInfo));
  },
});

let server;
let url;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 7, token: 'secret' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = \`http://127.0.0.1:\${server.address().port}/basket\`;
});
test.afterAll(() => server.close());

test(
  'adds to the basket',
  about('A shopper can add an item.', { tag: '@smoke', issue: 'SHOP-1' }),
  async ({ request }) => {
    await test.step('add', async () => {
      await test.step('send', async () => {
        const response = await request.post(url, { data: { item: 'kettle', password: 'p' } });
        expect(response.status(), 'status is 201').toBe(201);
      });
    });
  },
);
`,
);
const run = spawnSync('npx', ['playwright', 'test'], {
  cwd: work,
  stdio: 'inherit',
});
assert.equal(run.status, 0, 'the consumer suite passes');
const html = fs.readFileSync(path.join(work, 'report', 'index.html'), 'utf8');
assert.ok(
  html.includes('"level":"API","feature":"Checkout"'),
  'the report was written by the installed package',
);
assert.ok(html.includes('--accent: #123456;'), 'the theme with $schema loads');
const data = JSON.parse(
  html.match(
    /<script type="application\/json" id="report-data">(.*?)<\/script>/s,
  )[1],
);
const [scenario] = data.scenarios;
assert.equal(scenario.status, 'passed');
assert.deepEqual(scenario.tags, ['@smoke']);
assert.deepEqual(scenario.issues, ['SHOP-1']);
assert.equal(scenario.narrative, 'A shopper can add an item.');
// The whole tree: plumbing dropped, the recorded call in place of the request
// step. Older Playwright names steps differently, which breaks this.
const tree = (nodes) =>
  nodes.map((n) => [
    n.kind,
    n.title,
    ...(n.children.length ? [tree(n.children)] : []),
  ]);
const steps = scenario.runs[0].attempts[0].steps;
assert.deepEqual(
  tree(steps),
  [
    [
      'step',
      'add',
      [
        [
          'step',
          'send',
          [
            ['api', 'POST /basket → 201'],
            ['assertion', 'status is 201'],
          ],
        ],
      ],
    ],
  ],
  'the step tree',
);
const call = steps[0].children[0].children[0];
assert.equal(call.api.request.body.password, '[redacted]');
assert.equal(call.api.response.body.token, '[redacted]');

// The theme and option types, imported by package name and type-checked.
fs.writeFileSync(
  path.join(work, 'types.ts'),
  `import type {
  ColourToken,
  LivingReportOptions,
  Palette,
  ThemeFile,
  ThemeLogoFile,
} from '@fullstacktester/living-docs';

const accent: ColourToken = 'accent';
const light: Partial<Palette> = { [accent]: '#123456' };
const logo: ThemeLogoFile = { src: 'logo.svg', alt: 'Consumer' };
export const theme: ThemeFile = { $schema: '${schemaPath}', logo, light };
export const options: LivingReportOptions = { theme: 'brand' };
// @ts-expect-error not a colour token
export const wrong: ColourToken = 'acent';
`,
);
fs.writeFileSync(
  path.join(work, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      types: ['node'],
    },
    files: ['types.ts'],
  }),
);
const tsc = spawnSync('npx', ['tsc', '-p', 'tsconfig.json'], {
  cwd: work,
  stdio: 'inherit',
});
assert.equal(tsc.status, 0, 'the types resolve by package name');

const help = spawnSync('npx', ['living-docs', '--help'], {
  cwd: work,
  encoding: 'utf8',
});
assert.equal(help.status, 0);
assert.ok(help.stdout.includes('living-docs serve'), 'the bin is installed');

fs.rmSync(work, { recursive: true, force: true });
console.log('pack check: the installed package works by name');

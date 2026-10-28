# living-docs

A Playwright reporter that writes **living documentation**: a Serenity-style HTML report, without Serenity. It is one self-contained page (no CDN, nothing fetched at runtime) plus an `attachments/` folder.

- **Overview:** pass/fail donut, headline numbers, results by level and by feature, failures, slowest tests, run details (environment, branch, commit, CI link).
- **Levels:** one page per level (API, UI), its tests grouped by feature.
- **Features:** one page per feature, holding its tests at every level, one section per spec file. Both come from the folders a spec sits in, so the report needs no configuration to group tests.
- **Test page:** the title as the headline, a narrative, tags, issues, one tab per project (chromium, mobile-safari), attempts on retry, the error, the nested steps and the evidence (screenshot, video, trace).
- **Steps:** every `test.step`, action and check, expandable to any depth. The failure path starts open.
- **API calls:** every recorded call opens to show its request and response, headers and pretty-printed body. Calls the test makes (**Test API**) and calls the page makes in the browser (**Browser API**) are labelled apart, and browser calls sit under the step that made them.
- **Themes:** colours for light and dark mode, and a logo, from a JSON file.

The reporter has no runtime dependencies. Playwright (1.53 or later) is a peer.

## Install

```bash
npm install --save-dev @fullstacktester/living-docs
```

The package is ES modules only. A CommonJS project (no `"type": "module"` in its `package.json`) can still use it on Node 20.19 or later and Node 22.12 or later, which load ES modules from CommonJS. On an older Node, the project holding your Playwright config needs `"type": "module"`.

## Use

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    [
      '@fullstacktester/living-docs',
      {
        title: 'Shop tests',
        outputFolder: 'output/living-docs',
        issueUrl: 'https://example.atlassian.net/browse/{key}',
        theme: 'default',
      },
    ],
  ],
});
```

Lay specs out as `<testDir>/<level>/<feature>/<spec>.spec.ts`, where `testDir` is the project's:

```text
specs/                          ← testDir
  api/orders/create.spec.ts     → level API, feature Orders, spec Create
  ui/orders/checkout.spec.ts    → level UI, feature Orders, spec Checkout
```

- **Level:** the first folder. A name of up to three letters is shown in capitals (`api` is API, `e2e` is E2E); a longer one is humanised (`contract` is Contract).
- **Feature:** the next folder, humanised (`sign-in` is Sign in). Folders below it still belong to the feature. A spec straight in a level folder is its own feature, named by its file.
- **Spec:** the file name, humanised. A feature page has one section per spec.

A spec straight in `testDir` has level Other. Levels and features are listed A to Z.

When no spec is in a `<level>/<feature>/` folder, the run ends with a warning: usually every spec is straight in `testDir`, or `testDir` points at a level folder.

## View the report

Open `index.html` directly, or serve it:

```bash
npx living-docs serve output/living-docs          # http://127.0.0.1:9324/
npx living-docs serve output/living-docs --open   # and open it in the browser
```

| Option         | Default       | Meaning                                                                     |
| -------------- | ------------- | --------------------------------------------------------------------------- |
| `folder`       | `living-docs` | The report folder.                                                          |
| `-p`, `--port` | `9324`        | `0` picks a free port.                                                      |
| `--host`       | `127.0.0.1`   | Only this machine can reach it. Pass `0.0.0.0` to share it on your network. |
| `-o`, `--open` | off           | Opens the default browser.                                                  |

Serving is what makes the **Open in trace viewer** link work. From `file://` the trace downloads instead, and `npx playwright show-trace <file>` opens it. The server only answers GET and HEAD for files inside the folder.

## Shuffled runs

Playwright 1.64 added `--shuffle [seed]`. It runs test files (and tests in parallel mode) in a random order and prints the seed. When a run is shuffled, the report shows the seed in the header and the run details, with the command to run the same order again:

```bash
npx playwright test --shuffle          # a new random order
npx playwright test --shuffle 4242     # the order from seed 4242
```

## Narratives, tags and issues

`about()` builds Playwright's test details argument:

```ts
import { about } from '@fullstacktester/living-docs/annotations';

test(
  'places an order',
  about('A shopper who checks out gets an order number to quote.', {
    tag: '@smoke',
    issue: 'SHOP-123',
  }),
  async ({ page }) => {
    // ...
  },
);
```

The narrative shows under the headline. `tag` and `issue` each take a string or an array. An issue that is a key (`SHOP-123`) links through `issueUrl`, a URL links as it is, and other text is shown as written.

## Recording API calls

`@fullstacktester/living-docs/record` attaches every API call to the test, with secrets redacted, for the report to show.

```ts
// fixtures.ts
import { test as base } from '@playwright/test';
import {
  recordBrowserApiCalls,
  withApiAttachments,
} from '@fullstacktester/living-docs/record';

const redact = { headers: ['x-waf-bypass'], requestKeys: ['otp'] };

export const test = base.extend({
  // Calls the test makes with `request`.
  request: async ({ request, extraHTTPHeaders }, use, testInfo) => {
    await use(
      withApiAttachments(request, testInfo, { extraHTTPHeaders, redact }),
    );
  },
  // Calls the page makes in the browser.
  context: async ({ context, baseURL }, use, testInfo) => {
    const settle = recordBrowserApiCalls(context, testInfo, {
      match: `${baseURL}/api/`,
      redact,
    });
    await use(context);
    await settle();
  },
});
```

- **`withApiAttachments(context, testInfo, options?)`** wraps any `APIRequestContext`, including one you create with `playwright.request.newContext()`. It returns the same responses, so tests don't change.
- **`recordBrowserApiCalls(context, testInfo, { match, redact? })`** records the requests whose URL `match` accepts: a prefix, a list of prefixes, or a function. A prefix must be a full URL (`https://shop.example.com/api/`); anything else throws, which catches a prefix built from an unset `baseURL` (`"undefined/api/"`). It records every resource type: fetch, form posts and navigations. Call the function it returns before the test ends, so that no attachment is lost. A server's own calls (SSR) never pass through the browser, so they can't be recorded.

**Redaction** hides values before they reach the report:

| Option            | Meaning                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `headers`         | Extra header names to redact. The defaults are `authorization`, `proxy-authorization`, `cookie`, `set-cookie` and `x-api-key`.                                                                        |
| `keys`            | Extra JSON or form keys, in request and response bodies. The defaults are `password`, `secret`, `client_secret`, `api_key`, `code_verifier`, `access_token`, `id_token`, `refresh_token` and `token`. |
| `requestKeys`     | Keys redacted in request bodies only, for a name a response uses harmlessly (an error envelope's `code`).                                                                                             |
| `replaceDefaults` | Use only your lists.                                                                                                                                                                                  |
| `maxBodyChars`    | Longest body kept, in characters (default 200000).                                                                                                                                                    |

Redaction covers the attachments only. Traces, videos and screenshots can still hold what the browser saw, so treat test output as sensitive.

### The attachment format

Any code can feed the report by attaching JSON in this shape (`contentType: 'application/json'`). The attachment name becomes the step title.

```json
{
  "source": "browser",
  "startedAt": "2026-10-25T10:55:01.123Z",
  "durationMs": 182,
  "request": {
    "method": "GET",
    "url": "https://...",
    "headers": {},
    "body": null
  },
  "response": { "status": 200, "statusText": "OK", "headers": {}, "body": {} },
  "error": "only when there was no response"
}
```

- **`source`:** `"test"` (the default) or `"browser"`.
- **`startedAt`:** places a browser call under the innermost step running when the request started.
- **`durationMs`:** the call's own duration.
- **The request step:** a test call's attachment replaces the request step Playwright logs for the same call.

## Options

| Option         | Default       | Meaning                                                                                  |
| -------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `outputFolder` | `living-docs` | Relative to the config file. Cleared on each run, but only if this reporter wrote it.    |
| `title`        | `Test report` | Header and page title.                                                                   |
| `issueUrl`     | none          | Template for issue keys, `{key}` replaced.                                               |
| `theme`        | `default`     | A theme name or a path to a `.json` file, relative to the config. See [Themes](#themes). |

The report has no grouping options: the folders set each test's level and feature (see [Use](#use)).

The options are checked when Playwright loads the reporter, so a mistake stops the run before any test starts. An unknown option fails, naming the one you meant if it's close (`titel` gets "Did you mean "title"?"). Every option must be a non-empty string, and `issueUrl` must be an `http(s)` URL holding `{key}`. The theme and the output folder are checked at the same time.

## Themes

A theme sets the report's colours, for light and dark mode, and an optional logo for the top left of the header. The page follows the viewer's system setting. Each theme is a file named `<name>.theme.json`. `default` (teal and slate, no logo) is built in.

`theme: 'brand'` looks for the file in this order:

1. `brand.theme.json` beside the Playwright config
2. `themes/brand.theme.json` beside the Playwright config
3. the built-in themes

A path ending in `.json` also works, relative to the config.

A theme lists only what it changes. It extends `default` unless `extends` names another theme:

```json
{
  "name": "Ocean",
  "logo": { "src": "assets/ocean-logo.svg", "alt": "Ocean Ltd", "height": 32 },
  "light": {
    "header-bg": "#0b3954",
    "accent": "#087e8b",
    "highlight": "#ff5a5f"
  },
  "dark": { "header-bg": "#06202f", "accent": "#5fc9d3" }
}
```

Any of these stops the run before a test starts, with an error naming the problem:

- a missing theme, or one that extends itself
- a file that isn't a JSON object
- an unknown key, in the theme or its `logo` (a near miss names the key you meant: `lgo` gets "Did you mean "logo"?")
- an unknown colour name
- a colour value holding `;`, `{`, `}` or `<`
- a `name`, `description` or `extends` that isn't a string
- a missing logo image, one that isn't a file, or a missing `alt`
- a logo of the wrong type, over 1 MB, or with a `height` outside 16 to 80

**Logo:**

- `src` is required, relative to the theme file: an .svg, .png, .jpg, .webp or .gif up to 1 MB. It is embedded in the page.
- `alt` is required: the text a screen reader announces, usually the organisation's name.
- `height` is optional: 16 to 80 pixels, default 32.
- `srcDark` is optional: a different image for dark mode.
- A theme inherits its parent's logo, and `"logo": null` removes it.
- The logo sits on `header-bg`, so pick a version that contrasts with it.

| Token                                                      | Used for                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `bg`, `surface`, `surface-2`, `border`                     | Page, cards, hover and muted panels, lines                 |
| `text`, `text-2`                                           | Main and secondary text                                    |
| `accent`, `on-accent`                                      | Links, pressed filter buttons, step badges; text on accent |
| `highlight`                                                | Active tab and nav markers, narrative bar                  |
| `focus`                                                    | Keyboard focus outline                                     |
| `header-bg`, `header-text`, `header-hover`                 | The top bar                                                |
| `passed`, `failed`, `flaky`, `skipped`, `on-status`        | Status colours and charts; the glyph on a status icon      |
| `passed-soft`, `failed-soft`, `flaky-soft`, `skipped-soft` | Status badge and error backgrounds                         |
| `code-bg`                                                  | Code and body panels                                       |
| `api`                                                      | Test API call badges and HTTP methods                      |
| `browser`                                                  | Browser API call badges and their panel                    |
| `shadow`                                                   | Card shadow (`none` to remove)                             |

### Editor support

The package ships a JSON Schema for theme files. Point a theme at it with `$schema` and your editor completes keys and colour names, shows what each is for, and flags mistakes as you type:

```json
{
  "$schema": "./node_modules/@fullstacktester/living-docs/themes/theme.schema.json",
  "light": { "accent": "#087e8b" }
}
```

The path is a plain file path, relative to the theme file: a theme in `themes/` needs `../node_modules/...`. Where `node_modules` sits elsewhere (a hoisted monorepo), use a CDN URL pinned to your version instead:

```json
{
  "$schema": "https://unpkg.com/@fullstacktester/living-docs@0.1.0/themes/theme.schema.json"
}
```

To keep `$schema` out of the file, map the schema in your editor's settings instead. In VS Code, `.vscode/settings.json`:

```json
{
  "json.schemas": [
    {
      "fileMatch": ["*.theme.json"],
      "url": "./node_modules/@fullstacktester/living-docs/themes/theme.schema.json"
    }
  ]
}
```

The schema can't see files, so the reporter still checks a theme when the run starts: that the logo exists and is under 1 MB, and that `extends` finds a theme.

### Types

To build a theme in code, the package exports its types:

```ts
import type {
  ColourToken,
  Palette,
  ThemeFile,
  ThemeLogoFile,
} from '@fullstacktester/living-docs';
```

`LivingReportOptions`, the reporter's options, is exported too.

## Development

```bash
npm install
npm run build        # dist/
npm test             # unit tests (Vitest)
npm run test:e2e     # runs e2e/ through the built reporter, checks the report's data, then serves it and checks every page in Chromium
npm run pack:check   # packs, installs the tarball into a fresh project, runs it by package name
```

The end-to-end check needs Chromium: `npx playwright install chromium`. Its example suite has one test that fails and one that is flaky, on purpose, so the run's output shows them.

Layout:

- `src/index.ts`: the reporter.
- `src/build.ts`: steps, errors and attachments into the report model.
- `src/theme.ts`: theme loading.
- `src/html.ts`: the page shell.
- `src/client/`: the page's own script and styles. All test data is inserted as text, never as HTML.
- `src/record/`: the recorders and redaction.
- `src/annotations.ts`: `about()`.
- `src/serve.ts` and `src/cli.ts`: `living-docs serve`.

Releases: in a pull request, bump `version` and add a `CHANGELOG.md` entry. On merge to main, the release workflow runs every check again, then publishes the version to npm and tags the commit `v<version>`. A merge that leaves `version` as it is publishes nothing.

## Licence

[MIT](LICENSE)

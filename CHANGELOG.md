# Changelog

## 0.1.0

First release.

- **Reporter:** a self-contained HTML report with an overview, a page per level and per feature, and a page per test with its narrative, tags, issues, a tab per project, attempts on retry, errors, nested steps and evidence (screenshot, video, trace).
- **Grouping from the folders:** specs are laid out as `<testDir>/<level>/<feature>/<spec>.spec.ts`, relative to each project's `testDir`. Levels and features are listed A to Z, and a test's `describe` titles read as the start of its title. The run ends with a warning when no spec is in a `<level>/<feature>/` folder.
- **API calls:** `withApiAttachments` records the calls a test makes and `recordBrowserApiCalls` the calls the page makes, with request and response and configurable redaction. A browser call sits under the step that made it, including one that got no response. `recordBrowserApiCalls` throws when a `match` prefix isn't a full `http(s)` URL, such as `"undefined/api/"` from an unset `baseURL`.
- **Themes:** colours for light and dark mode and a logo, from `<name>.theme.json`, with a JSON Schema (`themes/theme.schema.json`) for completion and checking in the editor. The package exports the theme types: `ThemeFile`, `ThemeLogoFile`, `Palette` and `ColourToken`.
- **Setup checks:** the reporter's options, the theme and the output folder are checked when Playwright loads the reporter, so a mistake stops the run before any test starts. An unknown option or theme key fails, naming the one you meant if it's close.
- **Shuffled runs:** the report shows Playwright's shuffle seed (`--shuffle`, Playwright 1.64+), with the command to run the same order again.
- `about()` for narratives, tags and issues.
- `living-docs serve` to view a report over HTTP.
- Needs Playwright 1.53 or later and Node 20 or later. CI runs the oldest supported Playwright.

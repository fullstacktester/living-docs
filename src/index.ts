import fs from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { buildAttempt } from './build.js';
import { didYouMean, isObject } from './check.js';
import { loadTheme, type Theme } from './theme.js';
import { renderHtml } from './html.js';
import type { Attempt, ReportData, Run, Scenario, Status } from './model.js';

export type { ReportData } from './model.js';
export type {
  ColourToken,
  Palette,
  ThemeFile,
  ThemeLogoFile,
} from './theme.js';

export interface LivingReportOptions {
  /** Report folder, relative to the config file. Default `living-docs`. */
  outputFolder?: string;
  /** Shown in the header. Default `Test report`. */
  title?: string;
  /** Issue link template; `{key}` is replaced by an `issue` annotation's key. */
  issueUrl?: string;
  /**
   * Theme (colours and logo): a name (`brand` loads `brand.theme.json` from
   * beside the config, then from `themes/` beside it, then from the built-in
   * themes) or a path to a `.json` file, relative to the config. Default
   * `default`.
   */
  theme?: string;
}

const OPTION_KEYS = ['outputFolder', 'title', 'issueUrl', 'theme'] as const;

/**
 * Checks the options from the Playwright config, so a typo fails the run
 * instead of being ignored. Playwright adds `configDir`
 * and keys starting with `_` to every reporter's options; those pass.
 */
export function checkOptions(options: unknown): LivingReportOptions {
  if (options === undefined) return {};
  if (!isObject(options)) {
    throw new Error('living-docs: the reporter options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (key === 'configDir' || key.startsWith('_')) continue;
    if (!(OPTION_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `living-docs: unknown reporter option "${key}".${didYouMean(key, OPTION_KEYS)} Options: ${OPTION_KEYS.join(', ')}`,
      );
    }
    const value = options[key];
    if (value !== undefined && (typeof value !== 'string' || value === '')) {
      throw new Error(
        `living-docs: the "${key}" option must be a non-empty string`,
      );
    }
  }
  const { issueUrl } = options;
  if (
    typeof issueUrl === 'string' &&
    !(/^https?:\/\//.test(issueUrl) && issueUrl.includes('{key}'))
  ) {
    throw new Error(
      `living-docs: the "issueUrl" option must be an http(s) URL holding {key}, such as https://example.atlassian.net/browse/{key}; got "${issueUrl}"`,
    );
  }
  return options as LivingReportOptions;
}

/**
 * A warning when no spec is in a `<level>/<feature>/` folder, which usually
 * means the specs are not laid out for the report (all of them in testDir, or
 * testDir set to a level folder). Takes spec paths relative to their project's
 * testDir; undefined when any spec is laid out.
 */
export function layoutWarning(relativeFiles: string[]): string | undefined {
  if (relativeFiles.length === 0) return undefined;
  const laidOut = relativeFiles.some(
    (file) =>
      path.posix
        .dirname(file)
        .split('/')
        .filter((d) => d && d !== '.').length >= 2,
  );
  if (laidOut) return undefined;
  return (
    "living-docs: no spec is in a <level>/<feature>/ folder under its project's testDir, " +
    'so the report cannot group tests by level and feature. ' +
    'Lay specs out as <testDir>/<level>/<feature>/<spec>.spec.ts (see "Use" in the README).'
  );
}

/** Marks a folder this reporter wrote, so it is safe to clear. */
const MARKER = '.living-docs';

/** Fails unless the folder is missing, empty or one this reporter wrote. */
function checkFolder(folder: string): void {
  if (!fs.existsSync(folder)) return;
  const entries = fs.readdirSync(folder);
  if (entries.length > 0 && !entries.includes(MARKER)) {
    throw new Error(
      `living-docs: ${folder} exists and was not written by this reporter; choose another outputFolder`,
    );
  }
}

interface Collected {
  test: TestCase;
  attempts: Attempt[];
}

function describePath(test: TestCase): string[] {
  const titles: string[] = [];
  for (
    let suite: Suite | undefined = test.parent;
    suite;
    suite = suite.parent
  ) {
    if (suite.type === 'describe') titles.unshift(suite.title);
  }
  return titles;
}

function posix(p: string): string {
  return p.split(path.sep).join('/');
}

function statusOf(test: TestCase): Status {
  switch (test.outcome()) {
    case 'expected':
      return 'passed';
    case 'flaky':
      return 'flaky';
    case 'skipped':
      return 'skipped';
    default:
      return 'failed';
  }
}

/** A scenario's status across its runs: any failure fails it. */
function combine(statuses: Status[]): Status {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('flaky')) return 'flaky';
  if (statuses.every((s) => s === 'skipped')) return 'skipped';
  return 'passed';
}

function hashId(text: string): string {
  // FNV-1a: short, stable ids for URLs. Not for security.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Unique names, A to Z. */
function sorted(names: Iterable<string>): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** `sign-in` or `sign_in` as `Sign in`. */
export function humanise(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A level folder's name: `api` is API and `e2e` is E2E, `contract` is Contract. */
function levelName(dir: string): string {
  return dir.length <= 3 ? dir.toUpperCase() : humanise(dir);
}

/** The spec file name without its `.spec.ts` (or similar) suffix. */
function specName(file: string): string {
  return path.posix.basename(file).replace(/\.(spec|test)\.[cm]?[jt]sx?$/, '');
}

export interface Placement {
  level: string;
  feature: string;
  spec: string;
}

/**
 * Where a spec sits, from its path relative to the project's testDir:
 * `<level>/<feature>/<spec>.spec.ts`, so `api/forms/lookup.spec.ts` is level
 * API, feature Forms, spec Lookup. Deeper folders still belong to the feature.
 * A spec straight in a level folder is its own feature, named by its file; a
 * spec straight in testDir is level Other.
 */
export function placement(relativeFile: string): Placement {
  const dirs = path.posix
    .dirname(relativeFile)
    .split('/')
    .filter((d) => d && d !== '.');
  const spec = humanise(specName(relativeFile));
  return {
    level: dirs[0] ? levelName(dirs[0]) : 'Other',
    feature: dirs[1] ? humanise(dirs[1]) : spec,
    spec,
  };
}

function annotationValues(test: TestCase, ...types: string[]): string[] {
  return test.annotations
    .filter((a) => types.includes(a.type) && a.description)
    .map((a) => a.description as string);
}

/**
 * A Playwright reporter that writes a living-documentation report: an overview
 * with charts, tests grouped by level and by feature, each test's
 * nested steps, and every recorded API call's request and response.
 */
export default class LivingReport implements Reporter {
  private readonly options: LivingReportOptions;
  private config!: FullConfig;
  private outputFolder = '';
  private theme!: Theme;
  /** False until onBegin has run, so onEnd never hides an error from it. */
  private ready = false;
  private readonly collected = new Map<string, Collected>();

  constructor(options: LivingReportOptions = {}) {
    // Everything that can be wrong with the setup is checked here: an error
    // thrown while Playwright creates the reporter stops the run before any
    // test starts, while one thrown from onBegin is logged and the tests run.
    this.options = checkOptions(options);
    // Playwright passes the config's folder to every reporter.
    const { configDir } = options as { configDir?: unknown };
    if (typeof configDir === 'string') this.resolve(configDir);
  }

  /** The output folder and theme, relative to the config's folder. */
  private resolve(base: string): void {
    this.outputFolder = path.resolve(
      base,
      this.options.outputFolder ?? 'living-docs',
    );
    this.theme = loadTheme(this.options.theme, base);
    checkFolder(this.outputFolder);
  }

  /** The spec's path relative to its project's testDir, `/`-separated. */
  private specPath(test: TestCase): string {
    const testDir = test.parent.project()?.testDir ?? this.config.rootDir;
    return posix(path.relative(testDir, test.location.file));
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig): void {
    this.config = config;
    if (!this.outputFolder) {
      this.resolve(
        config.configFile ? path.dirname(config.configFile) : config.rootDir,
      );
    }
    this.prepareFolder();
    this.ready = true;
  }

  /** Clears a previous report, but only a folder this reporter made. */
  private prepareFolder(): void {
    const folder = this.outputFolder;
    checkFolder(folder);
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, MARKER), '');
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const entry = this.collected.get(test.id) ?? { test, attempts: [] };
    entry.attempts.push(
      buildAttempt(result, {
        rootDir: this.config.rootDir,
        outputFolder: this.outputFolder,
        filePrefix: `${hashId(test.id)}-${result.retry}`,
      }),
    );
    this.collected.set(test.id, entry);
  }

  private buildData(result: FullResult): ReportData {
    const rootDir = this.config.rootDir;
    const scenarios = new Map<string, Scenario>();

    for (const { test, attempts } of this.collected.values()) {
      const file = posix(path.relative(rootDir, test.location.file));
      const describes = describePath(test);
      const key = [file, ...describes, test.title].join('\u0000');
      const project = test.parent.project();
      const run: Run = {
        project: project?.name ?? '',
        status: statusOf(test),
        attempts,
      };

      let scenario = scenarios.get(key);
      if (!scenario) {
        scenario = {
          id: hashId(key),
          title: test.title,
          describePath: describes,
          file,
          line: test.location.line,
          ...placement(this.specPath(test)),
          tags: test.tags,
          narrative: annotationValues(test, 'description', 'narrative')[0],
          issues: annotationValues(test, 'issue'),
          status: run.status,
          duration: 0,
          runs: [],
        };
        scenarios.set(key, scenario);
      }
      scenario.runs.push(run);
    }

    for (const scenario of scenarios.values()) {
      scenario.runs.sort((a, b) => a.project.localeCompare(b.project));
      scenario.status = combine(scenario.runs.map((r) => r.status));
      scenario.duration = Math.max(
        0,
        ...scenario.runs.map((r) => r.attempts.at(-1)?.duration ?? 0),
      );
    }

    const list = [...scenarios.values()].sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
    );

    const metadata: Record<string, string> = {};
    const raw = (this.config.metadata ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      // Playwright adds the shuffle seed here; it gets its own field.
      if (k === 'shuffleSeed') continue;
      if (typeof v === 'string' || typeof v === 'number')
        metadata[k] = String(v);
    }
    const seed = raw.shuffleSeed;
    const commit = raw.gitCommit as
      | {
          hash?: string;
          subject?: string;
          branch?: string;
          author?: { name?: string };
        }
      | undefined;

    return {
      title: this.options.title ?? 'Test report',
      generatedAt: new Date().toISOString(),
      startTime: result.startTime.toISOString(),
      duration: result.duration,
      runStatus: result.status,
      shuffleSeed:
        typeof seed === 'string' || typeof seed === 'number'
          ? String(seed)
          : undefined,
      metadata,
      git: commit
        ? {
            hash: commit.hash,
            subject: commit.subject,
            branch: commit.branch,
            author: commit.author?.name,
          }
        : undefined,
      issueUrl: this.options.issueUrl,
      logo: this.theme.logo,
      projects: sorted(list.flatMap((s) => s.runs.map((r) => r.project))),
      levels: sorted(list.map((s) => s.level)),
      features: sorted(list.map((s) => s.feature)),
      scenarios: list,
    };
  }

  async onEnd(result: FullResult): Promise<void> {
    if (!this.ready) return;
    const data = this.buildData(result);
    const warning = layoutWarning(
      [...this.collected.values()].map(({ test }) => this.specPath(test)),
    );
    if (warning) process.stderr.write(`${warning}\n`);
    fs.writeFileSync(
      path.join(this.outputFolder, 'index.html'),
      renderHtml(data, this.theme),
    );
  }
}

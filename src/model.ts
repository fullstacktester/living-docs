/**
 * The report's data model. The reporter builds it from Playwright's reporter
 * API and embeds it in the HTML page as JSON; `client/app.js` renders it.
 */

/** A scenario's or a run's outcome, as the report shows it. */
export type Status = 'passed' | 'failed' | 'flaky' | 'skipped';

export interface ReportData {
  title: string;
  generatedAt: string;
  startTime: string;
  /** Milliseconds. */
  duration: number;
  /** Playwright's overall run status. */
  runStatus: string;
  /**
   * Playwright's shuffle seed when the run used `--shuffle` (1.64+), so the
   * same order can be run again with `--shuffle <seed>`.
   */
  shuffleSeed?: string;
  /** String-valued `config.metadata` entries, shown in the run details. */
  metadata: Record<string, string>;
  git?: GitInfo;
  /** URL template for issue keys, `{key}` replaced. */
  issueUrl?: string;
  /** The theme's logo, images as data URIs. */
  logo?: { src: string; srcDark?: string; alt: string; height: number };
  projects: string[];
  /** Level names, A to Z: the first folder under testDir (API, UI). */
  levels: string[];
  /** Feature names, A to Z: the folder under a level (Forms, Sign in). */
  features: string[];
  scenarios: Scenario[];
}

export interface GitInfo {
  hash?: string;
  subject?: string;
  branch?: string;
  author?: string;
}

/**
 * One test as written in a spec, across every project it ran in. A UI test
 * that runs in two browsers is one scenario with two runs.
 */
export interface Scenario {
  id: string;
  /** The test title: the scenario's headline. */
  title: string;
  /** Enclosing `describe` titles, outermost first. */
  describePath: string[];
  /** Spec file relative to the config's rootDir. */
  file: string;
  line: number;
  /** The first folder under the project's testDir, `api/` as API. */
  level: string;
  /** The folder under the level, humanised: `sign-in/` is Sign in. */
  feature: string;
  /** The spec file, humanised: `lookup.spec.ts` is Lookup. */
  spec: string;
  tags: string[];
  /** From a `description` or `narrative` annotation. */
  narrative?: string;
  /** From `issue` annotations: keys or URLs. */
  issues: string[];
  status: Status;
  /** Longest run, in milliseconds. */
  duration: number;
  runs: Run[];
}

export interface Run {
  project: string;
  status: Status;
  /** Every attempt, first to last; the last is the one that counts. */
  attempts: Attempt[];
}

export interface Attempt {
  retry: number;
  /** Playwright's raw result status (passed, failed, timedOut, ...). */
  status: string;
  duration: number;
  startTime: string;
  errors: ErrorInfo[];
  steps: StepNode[];
  /** Screenshots, video, trace and other attachments not shown in a step. */
  evidence: Evidence[];
}

export type StepKind =
  'step' | 'action' | 'assertion' | 'api' | 'hook' | 'attachment';

export interface StepNode {
  kind: StepKind;
  title: string;
  duration: number;
  failed: boolean;
  /** `file:line`, relative to rootDir. */
  location?: string;
  /** Epoch milliseconds; used to place browser API calls in the tree. */
  startTime?: number;
  error?: ErrorInfo;
  children: StepNode[];
  /** Present on an `api` step whose request and response were recorded. */
  api?: ApiCall;
  /** Present on an `attachment` step. */
  evidence?: Evidence;
}

export interface ErrorInfo {
  message: string;
  snippet?: string;
  location?: string;
}

export interface HttpMessage {
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * One recorded API call. The reporter reads it from a JSON attachment shaped
 * `{ request: { method, url, headers?, body? }, response?: { status,
 * statusText?, headers?, body? }, error? }` (see README).
 */
export interface ApiCall {
  /**
   * Who made the call: the test itself (the default), or the page in the
   * browser (`"source": "browser"` in the attachment).
   */
  source: 'test' | 'browser';
  /** ISO time the request started, when the attachment records it. */
  startedAt?: string;
  /** How long the call took, when the attachment records it. */
  durationMs?: number;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  request: HttpMessage;
  response?: HttpMessage;
  error?: string;
}

export type EvidenceKind = 'image' | 'video' | 'trace' | 'text' | 'file';

export interface Evidence {
  name: string;
  contentType: string;
  kind: EvidenceKind;
  /** Path relative to the report folder, for copied files. */
  href?: string;
  /** Inline content for small text attachments. */
  text?: string;
}

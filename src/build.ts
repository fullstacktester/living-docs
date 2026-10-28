import fs from 'node:fs';
import path from 'node:path';
import type {
  Location,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import type {
  ApiCall,
  Attempt,
  ErrorInfo,
  Evidence,
  EvidenceKind,
  HttpMessage,
  StepNode,
} from './model.js';

type Attachment = TestResult['attachments'][number];

/** Inline a text attachment up to this size; larger ones are linked. */
const MAX_INLINE_TEXT = 256 * 1024;

/** Playwright plumbing that says nothing about the scenario. */
const NOISE_ACTIONS =
  /^(Create request context|Launch browser|Create context|Create page|Close context|Close page|Dispose request context|Close browser)$/;

/**
 * Playwright's title for an API request step: the method alone (`GET`, 1.64
 * on) or the method and URL (`GET "forms/triage"`, before that).
 */
const REQUEST_STEP = /^(GET|POST|PUT|PATCH|DELETE|HEAD|FETCH)(\s+"|$)/i;

const HOOK_TITLES: Record<string, string> = {
  'Before Hooks': 'Setup',
  'After Hooks': 'Teardown',
  'Worker Cleanup': 'Worker cleanup',
  'beforeAll hook': 'Before all',
  'afterAll hook': 'After all',
  'beforeEach hook': 'Before each',
  'afterEach hook': 'After each',
};

// Terminal colour codes in Playwright's error messages.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** Context for one attempt: where files go and how paths are shown. */
export interface BuildContext {
  rootDir: string;
  outputFolder: string;
  /** Unique prefix for files this attempt copies. */
  filePrefix: string;
}

let fileCounter = 0;

function relativeLocation(
  rootDir: string,
  location: Location | undefined,
): string | undefined {
  if (!location) return undefined;
  const file = path.relative(rootDir, location.file).split(path.sep).join('/');
  return `${file}:${location.line}`;
}

export function toError(error: TestError, rootDir: string): ErrorInfo {
  return {
    message: stripAnsi(error.message ?? error.value ?? 'Unknown error').trim(),
    snippet: error.snippet ? stripAnsi(error.snippet) : undefined,
    location: relativeLocation(rootDir, error.location),
  };
}

function attachmentText(attachment: Attachment): string | undefined {
  if (attachment.body) return attachment.body.toString('utf8');
  if (attachment.path && fs.existsSync(attachment.path)) {
    return fs.readFileSync(attachment.path, 'utf8');
  }
  return undefined;
}

function asHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      String(v),
    ]),
  );
}

function asMessage(value: unknown): HttpMessage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return { headers: asHeaders(record.headers), body: record.body };
}

/**
 * Reads a recorded API call from a JSON attachment, or returns undefined when
 * the attachment is not one.
 */
export function parseApiCall(attachment: Attachment): ApiCall | undefined {
  if (!attachment.contentType.startsWith('application/json')) return undefined;
  const text = attachmentText(attachment);
  if (!text) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const { request, response, error, source, startedAt, durationMs } =
    parsed as Record<string, unknown>;
  if (!request || typeof request !== 'object') return undefined;
  const req = request as Record<string, unknown>;
  if (typeof req.method !== 'string' || typeof req.url !== 'string') {
    return undefined;
  }
  const res = response as Record<string, unknown> | undefined;
  return {
    source: source === 'browser' ? 'browser' : 'test',
    startedAt:
      typeof startedAt === 'string' && !Number.isNaN(Date.parse(startedAt))
        ? startedAt
        : undefined,
    durationMs:
      typeof durationMs === 'number' && durationMs >= 0
        ? durationMs
        : undefined,
    method: req.method.toUpperCase(),
    url: req.url,
    status: typeof res?.status === 'number' ? res.status : undefined,
    statusText:
      typeof res?.statusText === 'string' ? res.statusText : undefined,
    request: asMessage(req) ?? { headers: {} },
    response: asMessage(res),
    error: typeof error === 'string' ? error : undefined,
  };
}

function evidenceKind(attachment: Attachment): EvidenceKind {
  const { name, contentType } = attachment;
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (
    name === 'trace' ||
    (contentType === 'application/zip' && /trace/i.test(name))
  ) {
    return 'trace';
  }
  if (
    contentType.startsWith('text/') ||
    contentType.startsWith('application/json')
  ) {
    return 'text';
  }
  return 'file';
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}

/** Copies or inlines an attachment so the report folder is self-contained. */
export function toEvidence(
  attachment: Attachment,
  ctx: BuildContext,
): Evidence | undefined {
  const kind = evidenceKind(attachment);
  const evidence: Evidence = {
    name: attachment.name,
    contentType: attachment.contentType,
    kind,
  };

  if (kind === 'text') {
    const text = attachmentText(attachment);
    if (text !== undefined && text.length <= MAX_INLINE_TEXT) {
      evidence.text = text;
      return evidence;
    }
  }

  const dir = path.join(ctx.outputFolder, 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  fileCounter += 1;
  if (attachment.path) {
    if (!fs.existsSync(attachment.path)) return undefined;
    const file = `${ctx.filePrefix}-${fileCounter}-${safeName(path.basename(attachment.path))}`;
    fs.copyFileSync(attachment.path, path.join(dir, file));
    evidence.href = `attachments/${file}`;
    return evidence;
  }
  if (attachment.body) {
    const file = `${ctx.filePrefix}-${fileCounter}-${safeName(attachment.name)}`;
    fs.writeFileSync(path.join(dir, file), attachment.body);
    evidence.href = `attachments/${file}`;
    return evidence;
  }
  return undefined;
}

/** Identity of an attachment, stable across the step and result lists. */
function attachmentKey(attachment: Attachment): string {
  return `${attachment.name}|${attachment.path ?? ''}|${attachment.body?.length ?? ''}`;
}

function hasFailure(nodes: StepNode[]): boolean {
  return nodes.some((n) => n.failed);
}

/**
 * Turns Playwright's step tree into the report's. Fixture wrappers are lifted
 * away, setup plumbing is dropped, hooks are kept only when something in them
 * matters, and each recorded API call replaces the request step it records.
 * `shownAttachments` collects attachments placed in a step, so they are not
 * listed again as evidence.
 */
export function convertSteps(
  steps: TestStep[],
  ctx: BuildContext,
  shownAttachments: Set<string>,
): StepNode[] {
  const out: StepNode[] = [];
  for (const step of steps) {
    const children = convertSteps(step.steps, ctx, shownAttachments);
    const error = step.error ? toError(step.error, ctx.rootDir) : undefined;
    const base = {
      title: step.title,
      duration: step.duration,
      startTime: step.startTime.getTime(),
      location: relativeLocation(ctx.rootDir, step.location),
      error,
      children,
      failed: !!error || hasFailure(children),
    };

    switch (step.category) {
      case 'fixture':
        out.push(...children);
        break;

      case 'hook':
        if (children.length > 0 || error) {
          out.push({
            ...base,
            kind: 'hook',
            title: HOOK_TITLES[step.title] ?? step.title,
          });
        }
        break;

      case 'test.attach': {
        const attachment = step.attachments[0];
        if (!attachment) break;
        shownAttachments.add(attachmentKey(attachment));
        const api = parseApiCall(attachment);
        if (api) {
          // Playwright logs a test's own request as the step just before the
          // attachment; the recorded call replaces it. A browser call has no
          // such step.
          const previous = out[out.length - 1];
          let duration = step.duration;
          if (
            api.source === 'test' &&
            previous?.kind === 'api' &&
            !previous.api
          ) {
            out.pop();
            duration = previous.duration;
          }
          // The request step's location is the API wrapper or client, not
          // the test, so an API step shows none.
          out.push({
            ...base,
            kind: 'api',
            title: attachment.name,
            duration,
            location: undefined,
            api,
            failed: base.failed || !!api.error,
          });
          break;
        }
        const evidence = toEvidence(attachment, ctx);
        out.push({
          ...base,
          kind: 'attachment',
          title: attachment.name,
          evidence,
        });
        break;
      }

      case 'pw:api':
        if (NOISE_ACTIONS.test(step.title) && children.length === 0 && !error) {
          break;
        }
        out.push({
          ...base,
          kind: REQUEST_STEP.test(step.title) ? 'api' : 'action',
        });
        break;

      case 'expect':
        out.push({ ...base, kind: 'assertion' });
        break;

      case 'test.step':
        out.push({ ...base, kind: 'step' });
        break;

      default:
        out.push({ ...base, kind: 'action' });
    }
  }
  return out;
}

/** Steps a browser call can sit under: a `test.step` or a hook. */
function isContainer(node: StepNode): boolean {
  return node.kind === 'step' || node.kind === 'hook';
}

/** The innermost step or hook that was running at `time`. */
function stepRunningAt(nodes: StepNode[], time: number): StepNode | undefined {
  for (const node of nodes) {
    if (!isContainer(node) || node.startTime === undefined) continue;
    if (time >= node.startTime && time <= node.startTime + node.duration) {
      return stepRunningAt(node.children, time) ?? node;
    }
  }
  return undefined;
}

function isPlaceableBrowserCall(node: StepNode): boolean {
  return node.api?.source === 'browser' && node.api.startedAt !== undefined;
}

function takeBrowserCalls(nodes: StepNode[], into: StepNode[]): StepNode[] {
  return nodes.filter((node) => {
    if (isPlaceableBrowserCall(node)) {
      into.push(node);
      return false;
    }
    node.children = takeBrowserCalls(node.children, into);
    return true;
  });
}

/**
 * A browser call is attached when its response arrives, often after the step
 * that caused it has finished, so it lands in the wrong place. This moves each
 * one under the innermost step that was running when the request started, in
 * time order among that step's children. A call made outside every step stays
 * at the top level, in time order.
 */
export function placeBrowserCalls(steps: StepNode[]): StepNode[] {
  const calls: StepNode[] = [];
  const rest = takeBrowserCalls(steps, calls);
  const timed = calls
    .map((call) => ({ call, time: Date.parse(call.api!.startedAt!) }))
    .sort((a, b) => a.time - b.time);
  for (const { call, time } of timed) {
    const home = stepRunningAt(rest, time);
    const siblings = home ? home.children : rest;
    const at = siblings.findIndex(
      (node) => node.startTime !== undefined && node.startTime > time,
    );
    siblings.splice(at < 0 ? siblings.length : at, 0, {
      ...call,
      startTime: time,
      // The attach step is instant; the call's own timing is the real one.
      duration: call.api!.durationMs ?? call.duration,
    });
  }
  return rest;
}

export function buildAttempt(result: TestResult, ctx: BuildContext): Attempt {
  const shown = new Set<string>();
  const steps = convertSteps(result.steps, ctx, shown);
  const evidence: Evidence[] = [];
  for (const attachment of result.attachments) {
    if (shown.has(attachmentKey(attachment))) continue;
    // A recorded API call that no step showed still belongs in the steps.
    const api = parseApiCall(attachment);
    if (api) {
      steps.push({
        kind: 'api',
        title: attachment.name,
        duration: 0,
        failed: !!api.error,
        children: [],
        api,
      });
      continue;
    }
    const item = toEvidence(attachment, ctx);
    if (item) evidence.push(item);
  }
  return {
    retry: result.retry,
    status: result.status,
    duration: result.duration,
    startTime: result.startTime.toISOString(),
    errors: result.errors.map((e) => toError(e, ctx.rootDir)),
    steps: placeBrowserCalls(steps),
    evidence,
  };
}

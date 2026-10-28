import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertSteps, parseApiCall, placeBrowserCalls } from '../src/build.js';
import type { StepNode } from '../src/model.js';
import { jsonAttachment, step } from './helpers.js';

const ctx = {
  rootDir: '/repo',
  outputFolder: fs.mkdtempSync(path.join(os.tmpdir(), 'living-docs-')),
  filePrefix: 't',
};

const convert = (...steps: Parameters<typeof step>[0][]) =>
  convertSteps(steps.map(step), ctx, new Set());

const titles = (nodes: StepNode[]): unknown[] =>
  nodes.map((n) =>
    n.children.length ? [n.title, titles(n.children)] : n.title,
  );

describe('parseApiCall', () => {
  it('reads a recorded call, defaulting its source to test', () => {
    const call = parseApiCall(
      jsonAttachment('GET /a → 200', {
        request: { method: 'get', url: 'https://x/a', headers: { a: '1' } },
        response: {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: { ok: true },
        },
      }),
    );
    expect(call).toMatchObject({ source: 'test', method: 'GET', status: 200 });
    expect(call?.response?.body).toEqual({ ok: true });
  });

  it('reads a browser call with its timing', () => {
    const call = parseApiCall(
      jsonAttachment('x', {
        source: 'browser',
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 42,
        request: { method: 'POST', url: 'https://x/b' },
      }),
    );
    expect(call).toMatchObject({ source: 'browser', durationMs: 42 });
  });

  it('ignores JSON that is not a recorded call', () => {
    expect(parseApiCall(jsonAttachment('x', { hello: 1 }))).toBeUndefined();
    expect(
      parseApiCall({
        name: 'x',
        contentType: 'text/plain',
        body: Buffer.from('{}'),
      }),
    ).toBeUndefined();
  });
});

describe('convertSteps', () => {
  it('lifts fixture wrappers, drops plumbing and empty hooks, keeps hooks with content', () => {
    const nodes = convert(
      {
        title: 'Before Hooks',
        category: 'hook',
        steps: [
          {
            title: 'Fixture "page"',
            category: 'fixture',
            steps: [{ title: 'Create page', category: 'pw:api' }],
          },
        ],
      },
      {
        title: 'open the form',
        category: 'test.step',
        steps: [{ title: 'Click', category: 'pw:api' }],
      },
      {
        title: 'beforeAll hook',
        category: 'hook',
        steps: [{ title: 'fetch config', category: 'test.step' }],
      },
    );
    expect(titles(nodes)).toEqual([
      ['open the form', ['Click']],
      ['Before all', ['fetch config']],
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(['step', 'hook']);
  });

  it('replaces the request step with the recorded test call that follows it', () => {
    const nodes = convert(
      { title: 'GET "forms/triage"', category: 'pw:api', duration: 120 },
      {
        title: 'Attach "GET /api/forms/triage → 200"',
        category: 'test.attach',
        duration: 1,
        attachments: [
          jsonAttachment('GET /api/forms/triage → 200', {
            request: { method: 'GET', url: 'https://x/api/forms/triage' },
            response: { status: 200 },
          }),
        ],
      },
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      kind: 'api',
      title: 'GET /api/forms/triage → 200',
      duration: 120,
    });
  });

  it('replaces a request step titled by its method alone (Playwright 1.64)', () => {
    const nodes = convert(
      { title: 'POST', category: 'pw:api', duration: 80 },
      {
        title: 'Attach "POST /basket → 201"',
        category: 'test.attach',
        attachments: [
          jsonAttachment('POST /basket → 201', {
            request: { method: 'POST', url: 'https://x/basket' },
            response: { status: 201 },
          }),
        ],
      },
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'api', duration: 80 });
  });

  it('keeps a step whose title only starts with a method', () => {
    const [node] = convert({ title: 'Getting ready', category: 'pw:api' });
    expect(node?.kind).toBe('action');
  });

  it('never merges a browser call into a preceding request step', () => {
    const nodes = convert(
      { title: 'GET "forms/triage"', category: 'pw:api' },
      {
        title: 'Attach',
        category: 'test.attach',
        attachments: [
          jsonAttachment('PUT /v → 200 (browser)', {
            source: 'browser',
            request: { method: 'PUT', url: 'https://x/v' },
          }),
        ],
      },
    );
    expect(nodes).toHaveLength(2);
  });

  it('marks a step failed when a child failed', () => {
    const nodes = convert({
      title: 'outer',
      category: 'test.step',
      steps: [
        { title: 'inner', category: 'expect', error: { message: 'boom' } },
      ],
    });
    expect(nodes[0]?.failed).toBe(true);
    expect(nodes[0]?.children[0]?.error?.message).toBe('boom');
  });
});

describe('placeBrowserCalls', () => {
  const browserCall = (at: string, durationMs = 50): StepNode => ({
    kind: 'api',
    title: 'PUT /v → 200 (browser)',
    duration: 0,
    failed: false,
    children: [],
    api: {
      source: 'browser',
      startedAt: at,
      durationMs,
      method: 'PUT',
      url: 'https://x/v',
      request: { headers: {} },
    },
  });
  const node = (
    title: string,
    start: number,
    duration: number,
    children: StepNode[] = [],
  ): StepNode => ({
    kind: 'step',
    title,
    startTime: start,
    duration,
    failed: false,
    children,
  });

  it('moves a call under the innermost step running when it started, in time order', () => {
    const t = Date.parse('2026-01-01T00:00:00.000Z');
    const tree = [
      node('outer', t, 1000, [
        node('first', t, 100),
        node('second', t + 200, 500, [node('click', t + 210, 10)]),
      ]),
      browserCall(new Date(t + 250).toISOString(), 77),
    ];
    const placed = placeBrowserCalls(tree);
    expect(titles(placed)).toEqual([
      ['outer', ['first', ['second', ['click', 'PUT /v → 200 (browser)']]]],
    ]);
    const call = placed[0]!.children[1]!.children[1]!;
    expect(call.duration).toBe(77);
  });

  it('keeps a call made outside every step at the top level', () => {
    const t = Date.parse('2026-01-01T00:00:00.000Z');
    const placed = placeBrowserCalls([
      node('a', t, 10),
      browserCall(new Date(t + 5000).toISOString()),
    ]);
    expect(titles(placed)).toEqual(['a', 'PUT /v → 200 (browser)']);
  });
});

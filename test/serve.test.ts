import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  resolveInside,
  serveReport,
  type RunningServer,
} from '../src/serve.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-docs-serve-'));
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><title>r</title>',
);
fs.mkdirSync(path.join(root, 'attachments'));
fs.writeFileSync(path.join(root, 'attachments', 'trace.zip'), 'zip');
fs.writeFileSync(path.join(os.tmpdir(), 'living-docs-outside.txt'), 'secret');

describe('resolveInside', () => {
  it('resolves paths inside the folder', () => {
    expect(resolveInside(root, '/attachments/trace.zip')).toBe(
      path.join(root, 'attachments', 'trace.zip'),
    );
  });

  it('keeps every path inside the folder', () => {
    for (const p of ['/../x', '/%2e%2e/x', '/a/../../x', '/%2e%2e%2fx']) {
      const resolved = resolveInside(root, p);
      expect(resolved === undefined || resolved.startsWith(root)).toBe(true);
    }
    expect(resolveInside(root, '/%zz')).toBeUndefined();
  });
});

describe('serveReport', () => {
  let server: RunningServer;
  beforeAll(async () => {
    server = await serveReport({ root, port: 0 });
  });
  afterAll(() => server.close());

  it('binds to localhost and serves the report', async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<title>r</title>');
  });

  it('serves attachments with a type and CORS for the trace viewer', async () => {
    const res = await fetch(`${server.url}attachments/trace.zip`);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers 404 for a missing file and never serves outside the folder', async () => {
    expect((await fetch(`${server.url}missing.txt`)).status).toBe(404);
    const escaped = await fetch(`${server.url}..%2fliving-docs-outside.txt`);
    expect(await escaped.text()).not.toBe('secret');
  });

  it('refuses methods other than GET and HEAD', async () => {
    expect((await fetch(server.url, { method: 'POST' })).status).toBe(405);
    expect((await fetch(server.url, { method: 'HEAD' })).status).toBe(200);
  });

  it('fails clearly when there is no report', async () => {
    await expect(
      serveReport({ root: os.tmpdir() + '/nothing-here-xyz' }),
    ).rejects.toThrow(/no report at/);
  });
});

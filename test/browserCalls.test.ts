import type { BrowserContext, TestInfo } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { recordBrowserApiCalls } from '../src/record/browserCalls.js';

const context = { on: () => context } as unknown as BrowserContext;
const testInfo = {} as TestInfo;
const record = (match: unknown) =>
  recordBrowserApiCalls(context, testInfo, { match } as never);

describe('recordBrowserApiCalls', () => {
  it('takes a URL prefix, a list of them, or a function', () => {
    expect(() => record('https://shop.example.com/api/')).not.toThrow();
    expect(() =>
      record(['http://127.0.0.1:4789/api/', 'https://auth.example.com/']),
    ).not.toThrow();
    expect(() => record(() => true)).not.toThrow();
  });

  it.each([
    ['a prefix built from an unset baseURL', 'undefined/api/'],
    ['a path', '/api/'],
    ['an empty prefix', ''],
    ['a scheme with no host', 'https://'],
    ['one bad prefix in a list', ['https://shop.example.com/api/', '/auth/']],
    ['no prefix at all', undefined],
  ])('rejects %s', (_label, match) => {
    expect(() => record(match)).toThrow(/"match" must be a full URL prefix/);
  });

  it('rejects an empty list', () => {
    expect(() => record([])).toThrow(/lists no URL prefixes/);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import LivingReport, { checkOptions, layoutWarning } from '../src/index.js';

describe('checkOptions', () => {
  it('accepts every option, and the keys Playwright adds', () => {
    const options = {
      outputFolder: 'out',
      title: 'Shop',
      issueUrl: 'https://example.atlassian.net/browse/{key}',
      theme: 'default',
      configDir: '/project',
      _mode: 'test',
      _commandHash: 'abc',
    };
    expect(checkOptions(options)).toBe(options);
    expect(checkOptions(undefined)).toEqual({});
  });

  it.each([
    ['options that are not an object', 'shop', /must be an object/],
    [
      'a grouping option (the folders set the grouping)',
      { levels: ['UI', 'API'] },
      /unknown reporter option "levels"/,
    ],
    [
      'a misspelt option',
      { titel: 'Shop' },
      /unknown reporter option "titel"\. Did you mean "title"\?/,
    ],
    [
      'an option in the wrong case',
      { outputfolder: 'out' },
      /Did you mean "outputFolder"\?/,
    ],
    [
      'an unknown option with no near match',
      { colour: 'red' },
      /unknown reporter option "colour"\. Options: outputFolder/,
    ],
    ['a title that is not a string', { title: 1 }, /"title" option must be/],
    ['an empty output folder', { outputFolder: '' }, /"outputFolder" option/],
    ['a theme that is not a string', { theme: {} }, /"theme" option must be/],
    [
      'an issueUrl without {key}',
      { issueUrl: 'https://example.atlassian.net/browse/' },
      /http\(s\) URL holding \{key\}/,
    ],
    [
      'an issueUrl that is not a URL',
      { issueUrl: 'issues.example.com/{key}' },
      /got "issues\.example\.com\/\{key\}"/,
    ],
  ])('rejects %s', (_label, options, message) => {
    expect(() => checkOptions(options)).toThrow(message);
  });
});

describe('the reporter', () => {
  it('checks its setup when Playwright creates it, before any test runs', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'living-docs-'));
    fs.mkdirSync(path.join(configDir, 'theirs'));
    fs.writeFileSync(path.join(configDir, 'theirs', 'notes.txt'), '');
    expect(() => new LivingReport({ titel: 'x' } as never)).toThrow(/titel/);
    expect(
      () => new LivingReport({ theme: 'nope', configDir } as never),
    ).toThrow(/no theme "nope"/);
    expect(
      () => new LivingReport({ outputFolder: 'theirs', configDir } as never),
    ).toThrow(/was not written by this reporter/);
    expect(() => new LivingReport({ configDir } as never)).not.toThrow();
  });
});

describe('layoutWarning', () => {
  it('is quiet when any spec is in a level and feature folder', () => {
    expect(
      layoutWarning(['health.spec.ts', 'api/orders/create.spec.ts']),
    ).toBeUndefined();
    // A feature folder named like its spec is still laid out.
    expect(layoutWarning(['ui/sign-in/sign-in.spec.ts'])).toBeUndefined();
    expect(layoutWarning([])).toBeUndefined();
  });

  it('warns when no spec is', () => {
    expect(layoutWarning(['create.spec.ts', 'checkout.spec.ts'])).toMatch(
      /no spec is in a <level>\/<feature>\/ folder/,
    );
    // testDir set to a level folder: each feature reads as a level.
    expect(layoutWarning(['orders/create.spec.ts'])).toMatch(
      /<testDir>\/<level>\/<feature>\/<spec>\.spec\.ts/,
    );
  });
});

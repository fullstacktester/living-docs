import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTheme, themeCss } from '../src/theme.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function dir(files: Record<string, string | Buffer>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-docs-theme-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

describe('loadTheme', () => {
  it('loads the built-in default with every colour and no logo', () => {
    const theme = loadTheme(undefined, os.tmpdir());
    expect(theme.name).toBe('Default');
    expect(theme.logo).toBeUndefined();
    expect(themeCss(theme)).toContain('--header-bg:');
  });

  it('finds a theme beside the config, then in its themes folder', () => {
    const root = dir({
      'brand.theme.json': JSON.stringify({ light: { accent: '#111111' } }),
      'themes/other.theme.json': JSON.stringify({
        light: { accent: '#222222' },
      }),
    });
    expect(loadTheme('brand', root).light.accent).toBe('#111111');
    expect(loadTheme('other', root).light.accent).toBe('#222222');
    expect(loadTheme('./brand.theme.json', root).light.bg).toBe(
      loadTheme('default', root).light.bg,
    );
  });

  it('embeds a logo relative to the theme file, and a child can remove it', () => {
    const root = dir({
      'themes/brand.theme.json': JSON.stringify({
        logo: { src: 'assets/logo.png', alt: 'Brand Ltd', height: 30 },
      }),
      'themes/assets/logo.png': PNG,
      'nologo.theme.json': JSON.stringify({
        extends: './themes/brand.theme.json',
        logo: null,
      }),
    });
    const brand = loadTheme('brand', root);
    expect(brand.logo).toMatchObject({ alt: 'Brand Ltd', height: 30 });
    expect(brand.logo?.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(loadTheme('nologo', root).logo).toBeUndefined();
  });

  it('embeds a dark logo, and a child inherits both images', () => {
    const root = dir({
      'brand.theme.json': JSON.stringify({
        logo: { src: 'logo.svg', srcDark: 'logo-dark.png', alt: 'Brand Ltd' },
      }),
      'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'logo-dark.png': PNG,
      'child.theme.json': JSON.stringify({ extends: 'brand' }),
    });
    const { logo } = loadTheme('child', root);
    expect(logo?.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(logo?.srcDark?.startsWith('data:image/png;base64,')).toBe(true);
    expect(logo?.height).toBe(32);
  });

  it('accepts every documented key', () => {
    const root = dir({
      't.theme.json': JSON.stringify({
        $schema: './theme.schema.json',
        name: 'T',
        description: 'A theme',
        extends: 'default',
        logo: { src: 'x.png', srcDark: 'x.png', alt: 'T', height: 16 },
        light: { accent: '#111111' },
        dark: { accent: '#eeeeee' },
      }),
      'x.png': PNG,
    });
    expect(loadTheme('t', root)).toMatchObject({ name: 'T' });
  });

  it.each([
    ['an unknown theme', {}, 'nope', /no theme "nope"/],
    [
      'an unknown token',
      { 't.theme.json': '{"light":{"accnt":"#000"}}' },
      't',
      /unknown colour token/,
    ],
    [
      'an unsafe value',
      { 't.theme.json': '{"light":{"accent":"red;}</style>"}}' },
      't',
      /without ; \{ \} or </,
    ],
    [
      'a missing logo file',
      { 't.theme.json': '{"logo":{"src":"x.png","alt":"a"}}' },
      't',
      /logo image not found/,
    ],
    [
      'a logo without alt',
      { 't.theme.json': '{"logo":{"src":"x.png"}}' },
      't',
      /"logo.alt" is required/,
    ],
    [
      'an unsupported logo type',
      { 't.theme.json': '{"logo":{"src":"x.bmp","alt":"a"}}' },
      't',
      /must be one of/,
    ],
    ['invalid JSON', { 't.theme.json': '{' }, 't', /not valid JSON/],
    [
      'a theme that is not an object',
      { 't.theme.json': 'null' },
      't',
      /must be a JSON object/,
    ],
    [
      'a theme that is an array',
      { 't.theme.json': '[]' },
      't',
      /must be a JSON object/,
    ],
    [
      'a misspelt top-level key',
      { 't.theme.json': '{"lgo":{"src":"x.png","alt":"a"}}' },
      't',
      /unknown key "lgo"\. Did you mean "logo"\?/,
    ],
    [
      'a top-level key in the wrong case',
      { 't.theme.json': '{"Light":{}}' },
      't',
      /unknown key "Light"\. Did you mean "light"\?/,
    ],
    [
      'an unknown key with no near match',
      { 't.theme.json': '{"colours":{}}' },
      't',
      /unknown key "colours"\. Keys: \$schema, name/,
    ],
    [
      'a misspelt logo key',
      {
        't.theme.json': '{"logo":{"src":"x.png","alt":"a","srcdark":"y.png"}}',
      },
      't',
      /unknown key "logo\.srcdark"\. Did you mean "srcDark"\?/,
    ],
    [
      'a misspelt colour token',
      { 't.theme.json': '{"dark":{"acent":"#000"}}' },
      't',
      /unknown colour token "dark\.acent"\. Did you mean "accent"\?/,
    ],
    [
      'a name that is not a string',
      { 't.theme.json': '{"name":1}' },
      't',
      /"name" must be a string/,
    ],
    [
      'a $schema that is not a string',
      { 't.theme.json': '{"$schema":{}}' },
      't',
      /"\$schema" must be a string/,
    ],
    [
      'a description that is not a string',
      { 't.theme.json': '{"description":["a"]}' },
      't',
      /"description" must be a string/,
    ],
    [
      'an extends that is not a string',
      { 't.theme.json': '{"extends":5}' },
      't',
      /"extends" must be a theme name or path/,
    ],
    [
      'an empty extends',
      { 't.theme.json': '{"extends":""}' },
      't',
      /"extends" must be a theme name or path/,
    ],
    [
      'a theme that extends itself',
      {
        'a.theme.json': '{"extends":"./b.theme.json"}',
        'b.theme.json': '{"extends":"./a.theme.json"}',
      },
      'a',
      /theme extends itself/,
    ],
    [
      'a logo path that is a folder',
      {
        't.theme.json': '{"logo":{"src":"x.png","alt":"a"}}',
        'x.png/keep': '',
      },
      't',
      /"logo\.src" is not a file/,
    ],
    [
      'a missing dark logo file',
      {
        't.theme.json': '{"logo":{"src":"x.png","srcDark":"y.png","alt":"a"}}',
        'x.png': PNG,
      },
      't',
      /logo image not found: .*y\.png/,
    ],
    [
      'a dark logo that is not a path',
      {
        't.theme.json': '{"logo":{"src":"x.png","srcDark":true,"alt":"a"}}',
        'x.png': PNG,
      },
      't',
      /"logo\.srcDark" must be a path/,
    ],
    [
      'a logo shorter than 16px',
      {
        't.theme.json': '{"logo":{"src":"x.png","alt":"a","height":15}}',
        'x.png': PNG,
      },
      't',
      /"logo\.height" must be a number from 16 to 80/,
    ],
    [
      'a logo taller than 80px',
      {
        't.theme.json': '{"logo":{"src":"x.png","alt":"a","height":81}}',
        'x.png': PNG,
      },
      't',
      /"logo\.height" must be a number from 16 to 80/,
    ],
    [
      'a logo height that is not a number',
      {
        't.theme.json': '{"logo":{"src":"x.png","alt":"a","height":"32"}}',
        'x.png': PNG,
      },
      't',
      /"logo\.height" must be a number from 16 to 80/,
    ],
    [
      'a logo over 1 MB',
      {
        't.theme.json': '{"logo":{"src":"x.png","alt":"a"}}',
        'x.png': Buffer.alloc(1024 * 1024 + 1),
      },
      't',
      /logo image is over 1 MB/,
    ],
  ])('rejects %s', (_label, files, ref, message) => {
    expect(() => loadTheme(ref, dir(files))).toThrow(message);
  });
});

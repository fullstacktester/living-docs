import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COLOUR_TOKENS,
  IMAGE_TYPES,
  LOGO_KEYS,
  SAFE_VALUE,
  THEME_KEYS,
} from '../src/theme.js';

// The schema is for editors; the loader is the real check. These keep the two
// describing the same file, so an editor never flags a theme the loader takes.
const schema = JSON.parse(
  fs.readFileSync(
    new URL('../themes/theme.schema.json', import.meta.url),
    'utf8',
  ),
);
const logo = schema.properties.logo;

describe('theme.schema.json', () => {
  it('has the keys the loader accepts, and no others', () => {
    expect(Object.keys(schema.properties)).toEqual([...THEME_KEYS]);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(logo.properties)).toEqual([...LOGO_KEYS]);
    expect(logo.additionalProperties).toBe(false);
    expect(logo.required).toEqual(['src', 'alt']);
    expect(logo.type).toEqual(['object', 'null']);
  });

  it.each(['light', 'dark'])(
    'lists every colour token for %s mode, with the loader’s rule',
    (mode) => {
      const palette = schema.properties[mode];
      expect(Object.keys(palette.properties)).toEqual([...COLOUR_TOKENS]);
      expect(palette.additionalProperties).toBe(false);
      for (const token of COLOUR_TOKENS) {
        const { pattern, description } = palette.properties[token];
        expect(pattern, token).toBe(SAFE_VALUE.source);
        expect(description, token).toBeTruthy();
      }
    },
  );

  it('takes the image types and heights the loader takes', () => {
    for (const key of ['src', 'srcDark']) {
      const pattern = new RegExp(logo.properties[key].pattern);
      for (const ext of Object.keys(IMAGE_TYPES)) {
        expect(pattern.test(`logo${ext}`), ext).toBe(true);
        expect(pattern.test(`logo${ext.toUpperCase()}`), ext).toBe(true);
      }
      expect(pattern.test('logo.bmp')).toBe(false);
      expect(pattern.test('logo.svg.txt')).toBe(false);
    }
    expect(logo.properties.height).toMatchObject({
      type: 'number',
      minimum: 16,
      maximum: 80,
    });
  });
});

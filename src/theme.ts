import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { didYouMean, isObject } from './check.js';

/** Every colour the report uses. A theme sets them for light and dark mode. */
export const COLOUR_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'border',
  'text',
  'text-2',
  'accent',
  'on-accent',
  'highlight',
  'focus',
  'header-bg',
  'header-text',
  'header-hover',
  'passed',
  'failed',
  'flaky',
  'skipped',
  'on-status',
  'passed-soft',
  'failed-soft',
  'flaky-soft',
  'skipped-soft',
  'code-bg',
  'api',
  'browser',
  'shadow',
] as const;

export type ColourToken = (typeof COLOUR_TOKENS)[number];
export type Palette = Record<ColourToken, string>;

/** A logo as written in a theme file; paths are relative to that file. */
export interface ThemeLogoFile {
  /** Image file: .svg, .png, .jpg, .jpeg, .webp or .gif. */
  src: string;
  /** Optional image for dark mode. Default `src`. */
  srcDark?: string;
  /** Text alternative, for example the organisation's name. */
  alt: string;
  /** Display height in CSS pixels, 16 to 80. Default 32. */
  height?: number;
}

/**
 * The JSON in a `<name>.theme.json` file. `themes/theme.schema.json` describes
 * the same shape for editors.
 */
export interface ThemeFile {
  /** The JSON Schema an editor checks the file against. Ignored by the loader. */
  $schema?: string;
  name?: string;
  description?: string;
  /** Theme to start from, by name or path. Default `default`. */
  extends?: string;
  /** Shown in the top left of the header. `null` removes an inherited logo. */
  logo?: ThemeLogoFile | null;
  light?: Partial<Palette>;
  dark?: Partial<Palette>;
}

/** A loaded logo, its images embedded as data URIs. */
export interface ThemeLogo {
  src: string;
  srcDark?: string;
  alt: string;
  height: number;
}

export interface Theme {
  name: string;
  light: Palette;
  dark: Palette;
  logo?: ThemeLogo;
}

export const THEME_SUFFIX = '.theme.json';

/** The themes that ship with the package. */
export const BUILT_IN_THEMES_DIR = fileURLToPath(
  new URL('../themes/', import.meta.url),
);

/**
 * Colours, lengths, `rgba(...)`, `none` and shadow lists. No `;`, braces or
 * `<`, so a value cannot break out of the generated style rule.
 */
export const SAFE_VALUE = /^[#\w\s.,%()-]+$/;

export const IMAGE_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Logos are embedded in the page, so keep them small. */
export const MAX_LOGO_BYTES = 1024 * 1024;

/** The keys a theme file may hold. `$schema` points an editor at the schema. */
export const THEME_KEYS = [
  '$schema',
  'name',
  'description',
  'extends',
  'logo',
  'light',
  'dark',
] as const;
export const LOGO_KEYS = ['src', 'srcDark', 'alt', 'height'] as const;

/** Fails on the first key not in `known`, naming the nearest known one. */
function checkKeys(
  value: Record<string, unknown>,
  known: readonly string[],
  file: string,
  where: string,
): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) {
      throw new Error(
        `living-docs: ${file}: unknown key "${where}${key}".${didYouMean(key, known)} Keys: ${known.join(', ')}`,
      );
    }
  }
}

/**
 * Finds a theme file. A reference that ends in `.json` or holds a slash is a
 * path, relative to `baseDir`. A bare name looks for `<name>.theme.json` in
 * `baseDir`, then in `baseDir/themes/` (so a project can add or override a
 * theme beside its config), then among the built-in themes.
 */
export function resolveThemePath(
  reference: string,
  baseDir: string,
  exclude?: string,
): string {
  if (reference.endsWith('.json') || /[\\/]/.test(reference)) {
    const file = path.resolve(baseDir, reference);
    if (!fs.existsSync(file)) {
      throw new Error(`living-docs: theme file not found: ${file}`);
    }
    return file;
  }
  const candidates = [
    path.join(baseDir, `${reference}${THEME_SUFFIX}`),
    path.join(baseDir, 'themes', `${reference}${THEME_SUFFIX}`),
    path.join(BUILT_IN_THEMES_DIR, `${reference}${THEME_SUFFIX}`),
  ];
  // `exclude` stops a local `x.theme.json` that extends `x` from finding
  // itself: it extends the built-in `x`.
  const found = candidates.find(
    (file) => file !== exclude && fs.existsSync(file),
  );
  if (!found) {
    const builtIn = fs
      .readdirSync(BUILT_IN_THEMES_DIR)
      .filter((f) => f.endsWith(THEME_SUFFIX))
      .map((f) => f.slice(0, -THEME_SUFFIX.length));
    throw new Error(
      `living-docs: no theme "${reference}". Looked for ${candidates.join(', ')}. Built-in themes: ${builtIn.join(', ')}`,
    );
  }
  return found;
}

function checkPalette(
  palette: unknown,
  file: string,
  mode: string,
): Partial<Palette> {
  if (palette === undefined) return {};
  if (!isObject(palette)) {
    throw new Error(`living-docs: ${file}: "${mode}" must be an object`);
  }
  const known: readonly string[] = COLOUR_TOKENS;
  for (const [token, value] of Object.entries(palette)) {
    if (!known.includes(token)) {
      throw new Error(
        `living-docs: ${file}: unknown colour token "${mode}.${token}".${didYouMean(token, known)} Tokens: ${COLOUR_TOKENS.join(', ')}`,
      );
    }
    if (typeof value !== 'string' || !SAFE_VALUE.test(value)) {
      throw new Error(
        `living-docs: ${file}: "${mode}.${token}" must be a CSS colour (or shadow) without ; { } or <`,
      );
    }
  }
  return palette as Partial<Palette>;
}

function embedImage(src: string, themeFile: string, key: string): string {
  const file = path.resolve(path.dirname(themeFile), src);
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type) {
    throw new Error(
      `living-docs: ${themeFile}: "logo.${key}" must be one of ${Object.keys(IMAGE_TYPES).join(', ')}`,
    );
  }
  if (!fs.existsSync(file)) {
    throw new Error(`living-docs: ${themeFile}: logo image not found: ${file}`);
  }
  if (!fs.statSync(file).isFile()) {
    throw new Error(
      `living-docs: ${themeFile}: "logo.${key}" is not a file: ${file}`,
    );
  }
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_LOGO_BYTES) {
    throw new Error(
      `living-docs: ${themeFile}: logo image is over 1 MB: ${file}`,
    );
  }
  return `data:${type};base64,${bytes.toString('base64')}`;
}

function loadLogo(logo: unknown, file: string): ThemeLogo {
  if (!isObject(logo)) {
    throw new Error(`living-docs: ${file}: "logo" must be an object or null`);
  }
  checkKeys(logo, LOGO_KEYS, file, 'logo.');
  const { src, srcDark, alt, height } = logo;
  if (typeof src !== 'string' || src === '') {
    throw new Error(`living-docs: ${file}: "logo.src" is required`);
  }
  if (typeof alt !== 'string' || alt.trim() === '') {
    throw new Error(
      `living-docs: ${file}: "logo.alt" is required (the text a screen reader announces)`,
    );
  }
  if (srcDark !== undefined && typeof srcDark !== 'string') {
    throw new Error(`living-docs: ${file}: "logo.srcDark" must be a path`);
  }
  if (
    height !== undefined &&
    (typeof height !== 'number' || height < 16 || height > 80)
  ) {
    throw new Error(
      `living-docs: ${file}: "logo.height" must be a number from 16 to 80`,
    );
  }
  return {
    src: embedImage(src, file, 'src'),
    srcDark: srcDark ? embedImage(srcDark, file, 'srcDark') : undefined,
    alt,
    height: height ?? 32,
  };
}

/** The file's shape: an object of known keys, with strings where they belong. */
function checkThemeFile(json: unknown, file: string): ThemeFile {
  if (!isObject(json)) {
    throw new Error(`living-docs: ${file}: a theme must be a JSON object`);
  }
  checkKeys(json, THEME_KEYS, file, '');
  for (const key of ['$schema', 'name', 'description'] as const) {
    if (json[key] !== undefined && typeof json[key] !== 'string') {
      throw new Error(`living-docs: ${file}: "${key}" must be a string`);
    }
  }
  if (
    json.extends !== undefined &&
    (typeof json.extends !== 'string' || json.extends === '')
  ) {
    throw new Error(
      `living-docs: ${file}: "extends" must be a theme name or path`,
    );
  }
  return json as ThemeFile;
}

function load(file: string, seen: Set<string>): Theme {
  if (seen.has(file)) {
    throw new Error(`living-docs: theme extends itself: ${file}`);
  }
  seen.add(file);
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `living-docs: ${file} is not valid JSON: ${(error as Error).message}`,
      { cause: error },
    );
  }
  const parsed = checkThemeFile(json, file);
  const light = checkPalette(parsed.light, file, 'light');
  const dark = checkPalette(parsed.dark, file, 'dark');
  const logo =
    parsed.logo === undefined || parsed.logo === null
      ? parsed.logo
      : loadLogo(parsed.logo, file);
  const isRoot =
    path.basename(file) === `default${THEME_SUFFIX}` &&
    path.dirname(file) === path.resolve(BUILT_IN_THEMES_DIR);

  if (isRoot) {
    const missing = COLOUR_TOKENS.filter((t) => !light[t] || !dark[t]);
    if (missing.length > 0) {
      throw new Error(
        `living-docs: the default theme must set every colour token; missing ${missing.join(', ')}`,
      );
    }
    return {
      name: parsed.name ?? 'Default',
      light: light as Palette,
      dark: dark as Palette,
      logo: logo ?? undefined,
    };
  }

  const parentRef = parsed.extends ?? 'default';
  const parent = load(
    resolveThemePath(parentRef, path.dirname(file), file),
    seen,
  );
  return {
    name: parsed.name ?? path.basename(file, THEME_SUFFIX),
    light: { ...parent.light, ...light },
    dark: { ...parent.dark, ...dark },
    // Unset keeps the parent's logo; null removes it.
    logo: logo === undefined ? parent.logo : (logo ?? undefined),
  };
}

/** Loads a theme by name or path; `default` when none is given. */
export function loadTheme(
  reference: string | undefined,
  baseDir: string,
): Theme {
  return load(resolveThemePath(reference ?? 'default', baseDir), new Set());
}

function declarations(palette: Palette): string {
  return COLOUR_TOKENS.map((t) => `  --${t}: ${palette[t]};`).join('\n');
}

/** The theme's colours as CSS custom properties, dark mode under a media query. */
export function themeCss(theme: Theme): string {
  return `:root {
  color-scheme: light dark;
${declarations(theme.light)}
}

@media (prefers-color-scheme: dark) {
  :root {
${declarations(theme.dark)
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}
  }
}`;
}

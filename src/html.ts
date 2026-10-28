import fs from 'node:fs';
import { themeCss, type Theme } from './theme.js';
import type { ReportData } from './model.js';

function clientFile(name: string): string {
  return fs.readFileSync(new URL(`./client/${name}`, import.meta.url), 'utf8');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * JSON that is safe inside a `<script>` element: `<` is escaped, so test data
 * holding `</script>` cannot end the element, and U+2028/U+2029 are escaped
 * for older parsers.
 */
function scriptSafeJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** One self-contained page: data, styles and script inline, nothing fetched. */
export function renderHtml(data: ReportData, theme: Theme): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)}</title>
<style>
${themeCss(theme)}

${clientFile('styles.css')}
</style>
</head>
<body>
<div id="app" aria-live="polite"></div>
<noscript>This report needs JavaScript.</noscript>
<script type="application/json" id="report-data">${scriptSafeJson(data)}</script>
<script>
${clientFile('app.js')}
</script>
</body>
</html>
`;
}

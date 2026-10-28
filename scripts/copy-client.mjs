// The reporter reads the report page's own script and styles from disk, next
// to its compiled code, so they are copied into dist/client.
import fs from 'node:fs';

const from = new URL('../src/client/', import.meta.url);
const to = new URL('../dist/client/', import.meta.url);
fs.mkdirSync(to, { recursive: true });
for (const name of ['app.js', 'styles.css']) {
  fs.copyFileSync(new URL(name, from), new URL(name, to));
}
fs.chmodSync(new URL('../dist/cli.js', import.meta.url), 0o755);

#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { serveReport } from './serve.js';

const USAGE = `Usage: living-docs serve [folder] [options]

Serves a living-docs report over HTTP on this machine.

  folder            the report folder (default: living-docs)

Options:
  -p, --port <n>    port (default: 9324; 0 picks a free one)
      --host <h>    interface (default: 127.0.0.1)
  -o, --open        open the report in the default browser
  -h, --help        show this help`;

function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => console.log(`Open ${url} in your browser.`));
  child.unref();
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      open: { type: 'boolean', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, folder, ...extra] = positionals;
  if (values.help || command === undefined) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  if (command !== 'serve' || extra.length > 0) {
    console.error(USAGE);
    return 1;
  }
  const port = values.port === undefined ? undefined : Number(values.port);
  if (
    port !== undefined &&
    (!Number.isInteger(port) || port < 0 || port > 65535)
  ) {
    console.error(`living-docs: --port must be a number from 0 to 65535`);
    return 1;
  }

  const server = await serveReport({
    root: folder ?? 'living-docs',
    port,
    host: values.host,
  });
  console.log(`Serving the report at ${server.url} (Ctrl+C to stop)`);
  if (values.open) openInBrowser(server.url);
  const stop = () => void server.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return -1;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);

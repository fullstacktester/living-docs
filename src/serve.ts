import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
};

export interface ServeOptions {
  /** The report folder. */
  root: string;
  /** Default 9324. 0 picks a free port. */
  port?: number;
  /** Default 127.0.0.1, so the report is not exposed on the network. */
  host?: string;
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Resolves a request path inside `root`, or returns undefined when it would
 * escape it (`..`, an absolute path, an encoded separator).
 */
export function resolveInside(
  root: string,
  requestPath: string,
): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/');
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) return undefined;
  const target = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return target;
}

/**
 * Serves a report folder over HTTP: needed for the trace viewer link, which a
 * page opened from `file://` cannot offer. Only GET and HEAD, only files under
 * the folder, never a directory listing.
 */
export function serveReport(options: ServeOptions): Promise<RunningServer> {
  const root = path.resolve(options.root);
  const index = path.join(root, 'index.html');
  if (!fs.existsSync(index)) {
    return Promise.reject(
      new Error(
        `living-docs: no report at ${index}. Run the tests first, or pass the report folder.`,
      ),
    );
  }
  const host = options.host ?? '127.0.0.1';

  const server = http.createServer((req, res) => {
    const send = (status: number, text: string) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : text);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD');
      send(405, 'Method not allowed');
      return;
    }
    let file = resolveInside(root, req.url ?? '/');
    if (!file) {
      send(400, 'Bad request');
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      send(404, 'Not found');
      return;
    }
    res.writeHead(200, {
      'content-type':
        TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': fs.statSync(file).size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // trace.playwright.dev fetches the trace file from this server.
      'access-control-allow-origin': '*',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 9324, host, () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address ? address.port : options.port;
      const shownHost = host.includes(':') ? `[${host}]` : host;
      resolve({
        url: `http://${shownHost}:${port}/`,
        close: () =>
          new Promise<void>((done, fail) =>
            server.close((e) => (e ? fail(e) : done())),
          ),
      });
    });
  });
}

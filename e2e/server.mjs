// A tiny shop for the end-to-end check: pages that call the API, and the API.
import http from 'node:http';

const CHECKOUT = `<!doctype html><html><body>
<h1>Checkout</h1>
<button id="buy">Buy</button>
<p id="result"></p>
<script>
document.getElementById('buy').addEventListener('click', async () => {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item: 'kettle', password: 'browser-secret' }),
  });
  const order = await res.json();
  document.getElementById('result').textContent = 'Order ' + order.id;
});
</script></body></html>`;

// A form that posts (a navigation), and a stock check the test makes fail.
const NEWSLETTER = `<!doctype html><html><body>
<h1>Newsletter</h1>
<p id="stock">Checking stock…</p>
<form method="post" action="/api/newsletter">
  <label>Email <input name="email" type="email"></label>
  <input type="hidden" name="token" value="form-secret">
  <button>Subscribe</button>
</form>
<script>
fetch('/api/stock').then(
  () => (document.getElementById('stock').textContent = 'In stock'),
  () => (document.getElementById('stock').textContent = 'Stock unknown'),
);
</script></body></html>`;

const THANKS = `<!doctype html><html><body><h1>Thanks for subscribing</h1></body></html>`;

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
}

function html(res, page) {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page);
}

http
  .createServer(async (req, res) => {
    const route = `${req.method} ${req.url}`;
    if (route === 'GET /' || route === 'GET /checkout') html(res, CHECKOUT);
    else if (route === 'GET /newsletter') html(res, NEWSLETTER);
    else if (route === 'GET /api/health') json(res, 200, { ok: true });
    else if (route === 'GET /api/orders')
      json(res, 200, { items: [{ id: 1, item: 'kettle' }] });
    else if (route === 'POST /api/orders') {
      const body = await readBody(req);
      json(
        res,
        201,
        { id: 42, received: JSON.parse(body || '{}') },
        { 'set-cookie': 'session=abc' },
      );
    } else if (route === 'POST /api/sign-in') {
      const { password, otp } = JSON.parse((await readBody(req)) || '{}');
      if (password === 'right')
        // `otp` is redacted in requests only, so the response keeps it.
        json(res, 200, { token: 'session-token', otp, user: 'sam' });
      else json(res, 401, { error: 'bad password' });
    } else if (route === 'GET /api/session') json(res, 200, { active: true });
    else if (route === 'POST /api/newsletter') {
      await readBody(req);
      html(res, THANKS);
    } else {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(4789, '127.0.0.1');

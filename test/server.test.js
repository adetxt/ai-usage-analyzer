import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardServer } from '../src/server.js';

test('dashboard serves local assets and usage while rejecting cross-origin requests', async () => {
  const server = createDashboardServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Usage overview/);
    for (const [path, type] of [['/app.js', 'javascript'], ['/aggregate.js', 'javascript'], ['/style.css', 'css'], ['/favicon.svg', 'svg'], ['/gsap.js', 'javascript'], ['/fonts/manrope.woff2', 'font/woff2'], ['/icons/claude.svg', 'svg'], ['/icons/openai.svg', 'svg'], ['/icons/opencode.svg', 'svg']]) {
      const asset = await fetch(`${url}${path}`);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get('content-type'), new RegExp(type));
    }
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    const api = await fetch(`${url}/api/usage`);
    assert.equal(api.status, 200);
    const result = await api.json();
    assert.ok(Array.isArray(result.records));
    assert.ok(Array.isArray(result.detections));
    assert.equal((await fetch(`${url}/api/usage`, { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await fetch(`${url}/api/usage`, { method: 'POST' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

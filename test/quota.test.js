import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodexQuota, parseClaudeQuota } from '../src/quota.js';

test('Codex quota labels windows by duration, including reversed windows', () => {
  const result = parseCodexQuota({ rate_limit: { primary_window: { used_percent: 22, limit_window_seconds: 604800, reset_at: 100 }, secondary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: 50 } } });
  assert.deepEqual(result.windows.map(w => [w.label, w.usedPercent]), [['Weekly', 22], ['Session', 10]]);
});

test('Claude quota parses known windows and monthly extra usage', () => {
  const result = parseClaudeQuota({ five_hour: { utilization: 12, resets_at: '2026-01-01T00:00:00Z' }, seven_day: { utilization: 25 }, extra_usage: { is_enabled: true, monthly_limit: 1000, used_credits: 500 } });
  assert.deepEqual(result.windows.map(w => w.label), ['Session', 'Weekly', 'Extra usage']);
  assert.equal(result.windows[2].usedPercent, 50);
});

test('quota requests use the correct vendor endpoint and return no credentials', async () => {
  const { fetchQuota } = await import('../src/quota.js');
  const seen = [];
  const fetcher = async (url, options) => {
    seen.push([url, options.headers.Authorization]);
    return { ok: true, status: 200, json: async () => ({ five_hour: { utilization: 12 } }) };
  };
  const result = await fetchQuota('claude', { accessToken: 'secret' }, fetcher);
  assert.deepEqual(seen, [['https://api.anthropic.com/api/oauth/usage', 'Bearer secret']]);
  assert.equal(result.windows[0].usedPercent, 12);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('credential files are read for both providers without exposing raw data', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readCredentials } = await import('../src/quota.js');
  const home = mkdtempSync(join(tmpdir(), 'quota-'));
  try {
    mkdirSync(join(home, 'claude')); mkdirSync(join(home, 'codex'));
    writeFileSync(join(home, 'claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'c', scopes: ['user:profile'] } }));
    writeFileSync(join(home, 'codex', 'auth.json'), JSON.stringify({ tokens: { access_token: 'o', account_id: 'a' } }));
    assert.equal((await readCredentials('claude', { CLAUDE_HOME: join(home, 'claude') }, { platform: 'linux' })).accessToken, 'c');
    assert.equal((await readCredentials('codex', { CODEX_HOME: join(home, 'codex') })).accountId, 'a');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Codex refresh preserves unrelated auth fields and returns fresh token', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { refreshCodexCredentials } = await import('../src/quota.js');
  const dir = mkdtempSync(join(tmpdir(), 'quota-refresh-'));
  const path = join(dir, 'auth.json');
  try {
    writeFileSync(path, JSON.stringify({ tokens: { access_token: 'old', refresh_token: 'refresh', account_id: 'acct' }, other: 'kept' }), { mode: 0o600 });
    const result = await refreshCodexCredentials(path, async () => ({ ok: true, json: async () => ({ access_token: 'new', refresh_token: 'next', id_token: 'id' }) }));
    assert.equal(result.accessToken, 'new');
    const updated = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(updated.other, 'kept');
    assert.equal(updated.tokens.account_id, 'acct');
    assert.equal(updated.tokens.refresh_token, 'next');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Codex refresh refuses to overwrite changed credentials', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { refreshCodexCredentials } = await import('../src/quota.js');
  const dir = mkdtempSync(join(tmpdir(), 'quota-race-'));
  const path = join(dir, 'auth.json');
  try {
    writeFileSync(path, JSON.stringify({ tokens: { access_token: 'old', refresh_token: 'refresh' } }));
    await assert.rejects(refreshCodexCredentials(path, async () => {
      writeFileSync(path, JSON.stringify({ tokens: { access_token: 'other' } }));
      return { ok: true, json: async () => ({ access_token: 'new', refresh_token: 'next' }) };
    }), /changed/);
    assert.equal(JSON.parse(readFileSync(path)).tokens.access_token, 'other');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Claude uses keychain before credentials file and reports keychain timeout', async () => {
  const { readCredentials } = await import('../src/quota.js');
  const getKeychain = async () => JSON.stringify({ claudeAiOauth: { accessToken: 'keychain', scopes: ['user:profile'] } });
  assert.equal((await readCredentials('claude', {}, { platform: 'darwin', getKeychain })).accessToken, 'keychain');
  await assert.rejects(readCredentials('claude', {}, { platform: 'darwin', getKeychain: async () => { const e = new Error('timeout'); e.killed = true; throw e; } }), /Keychain.*timed out/);
});

test('quota collection handles errors independently and refreshes stale Codex credentials', async () => {
  const { collectQuotas } = await import('../src/quota.js');
  const result = await collectQuotas({
    read: async provider => provider === 'claude' ? { accessToken: 'claude' } : { accessToken: 'old', authPath: '/fixture', lastRefresh: '2020-01-01T00:00:00Z' },
    refresh: async () => ({ accessToken: 'new' }),
    fetch: async (provider, credentials) => provider === 'claude' ? Promise.reject(new Error('failed')) : { provider, windows: [{ label: 'Session', usedPercent: credentials.accessToken === 'new' ? 10 : 99 }] },
  });
  assert.equal(result[0].provider, 'claude');
  assert.ok(result[0].error);
  assert.equal(result[1].windows[0].usedPercent, 10);
});

test('quota report shows provider errors and reset times without secrets', async () => {
  const { renderQuota } = await import('../src/quota.js');
  const text = renderQuota([{ provider: 'claude', windows: [{ label: 'Session', usedPercent: 25, resetAt: '2026-01-01T00:00:00Z' }] }, { provider: 'codex', error: 'Login required', windows: [] }]);
  assert.match(text, /Claude.*Session.*25%/s);
  assert.match(text, /2026-01-01/);
  assert.match(text, /Codex.*Login required/s);
});

test('CLI help documents opt-in quotas for reports', async () => {
  const { execFileSync } = await import('node:child_process');
  const output = execFileSync(process.execPath, ['bin/ai-usage.js', '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(output, /--quota/);
});

test('quota requests can be cancelled when the TUI exits', async () => {
  const { fetchQuota } = await import('../src/quota.js');
  const controller = new AbortController();
  const request = fetchQuota('codex', { accessToken: 'fixture' }, async (_url, options) => {
    await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  }, controller.signal);
  controller.abort();
  await assert.rejects(request, /aborted/);
});

test('Claude quota accepts design and routines aliases', () => {
  const result = parseClaudeQuota({ seven_day_design: { utilization: 7 }, seven_day_cowork: { utilization: 8 } });
  assert.deepEqual(result.windows.map(w => [w.label, w.usedPercent]), [['Designs', 7], ['Daily Routines', 8]]);
});

test('quitting before credential read completes does not start a Codex refresh', async () => {
  const { collectQuotas } = await import('../src/quota.js');
  const controller = new AbortController();
  let unblock;
  let refreshes = 0;
  const ready = new Promise(resolve => { unblock = resolve; });
  const result = collectQuotas({ signal: controller.signal, read: async provider => {
    if (provider === 'codex') { await ready; return { accessToken: 'old', authPath: '/fixture', lastRefresh: '2020-01-01T00:00:00Z' }; }
    return { accessToken: 'test' };
  }, refresh: async () => { refreshes++; return { accessToken: 'new' }; }, fetch: async provider => ({ provider, windows: [] }) });
  controller.abort();
  unblock();
  await result;
  assert.equal(refreshes, 0);
});

test('invalid quota tokens report a provider-specific login action', async () => {
  const { fetchQuota } = await import('../src/quota.js');
  const response = async () => ({ ok: false, status: 401 });
  await assert.rejects(fetchQuota('claude', { accessToken: 'fixture' }, response), /run claude/i);
  await assert.rejects(fetchQuota('codex', { accessToken: 'fixture' }, response), /codex login/i);
});

test('Codex refresh accepts a response without a replacement refresh token', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { refreshCodexCredentials } = await import('../src/quota.js');
  const dir = mkdtempSync(join(tmpdir(), 'quota-refresh-')); const path = join(dir, 'auth.json');
  try {
    writeFileSync(path, JSON.stringify({ tokens: { access_token: 'old', refresh_token: 'fixture-refresh' } }));
    let body;
    await refreshCodexCredentials(path, async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ access_token: 'new' }) }; });
    assert.equal(body.scope, 'openid profile email');
    assert.equal(JSON.parse(readFileSync(path)).tokens.refresh_token, 'fixture-refresh');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Claude extra quota shows its monthly credit cap in currency units', async () => {
  const { renderQuota } = await import('../src/quota.js');
  const parsed = parseClaudeQuota({ extra_usage: { is_enabled: true, monthly_limit: 1000, used_credits: 450, currency: 'USD' } });
  assert.equal(parsed.windows[0].limit, 10);
  assert.equal(parsed.windows[0].used, 4.5);
  assert.match(renderQuota([{ provider: 'claude', ...parsed }]), /4\.50.*10\.00/);
});

test('Claude quota uses the installed CLI version in its user agent', async () => {
  const { fetchQuota } = await import('../src/quota.js');
  let agent;
  await fetchQuota('claude', { accessToken: 'fixture' }, async (_url, options) => { agent = options.headers['User-Agent']; return { ok: true, json: async () => ({}) }; }, undefined, async () => '2.9.1 (Claude Code)');
  assert.equal(agent, 'claude-code/2.9.1');
});

test('Codex quota includes account identity from its login token', async () => {
  const { fetchQuota, renderQuota } = await import('../src/quota.js');
  const claims = Buffer.from(JSON.stringify({ email: 'fixture@example.test', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } })).toString('base64url');
  const result = await fetchQuota('codex', { accessToken: 'fixture', idToken: `x.${claims}.x` }, async () => ({ ok: true, json: async () => ({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000 } } }) }));
  assert.equal(result.email, 'fixture@example.test');
  assert.equal(result.plan, 'plus');
  assert.match(renderQuota([result]), /fixture@example\.test.*plus/);
});

test('quota reset times omit zero and invalid epoch values', () => {
  const result = parseCodexQuota({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: 0 }, secondary_window: { used_percent: 20, limit_window_seconds: 604800, reset_at: 1e300 } } });
  assert.equal(result.windows[0].resetAt, null);
  assert.equal(result.windows[1].resetAt, null);
});

test('quota display strips terminal control characters from provider data', async () => {
  const { renderQuota } = await import('../src/quota.js');
  const text = renderQuota([{ provider: 'codex', plan: '\u001b]0;hijack\u0007', windows: [{ label: '\u001b[31mCustom', usedPercent: 10, resetAt: null }] }]);
  assert.doesNotMatch(text, /[\u001b\u0007]/);
});

test('Codex refreshes when the refresh timestamp is missing or malformed', async () => {
  const { collectQuotas } = await import('../src/quota.js');
  for (const lastRefresh of [undefined, 'invalid']) {
    let refreshed = 0;
    const result = await collectQuotas({
      read: async provider => provider === 'codex' ? { accessToken: 'old', authPath: '/fixture', lastRefresh } : { accessToken: 'fixture' },
      refresh: async () => { refreshed++; return { accessToken: 'new' }; },
      fetch: async (provider, credentials) => ({ provider, windows: [{ label: 'Session', usedPercent: credentials.accessToken === 'new' ? 10 : 20 }] }),
    });
    assert.equal(refreshed, 1);
    assert.equal(result[1].windows[0].usedPercent, 10);
  }
});

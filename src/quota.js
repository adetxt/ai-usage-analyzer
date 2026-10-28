import { readFile, open, rename, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resetTime(value) {
  const seconds = number(value);
  if (seconds === null || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function parseCodexQuota(data) {
  const windows = [];
  function add(rate, prefix = '') {
    for (const w of [rate?.primary_window, rate?.secondary_window]) {
      if (!w || number(w.used_percent) === null) continue;
      const duration = number(w.limit_window_seconds);
      const name = duration === 18000 ? 'Session' : duration === 604800 ? 'Weekly' : 'Limit';
      windows.push({ label: prefix ? `${prefix} ${name}` : name, usedPercent: number(w.used_percent), resetAt: resetTime(w.reset_at) });
    }
  }
  add(data.rate_limit);
  for (const extra of data.additional_rate_limits || []) {
    const name = extra.limit_name || extra.metered_feature || 'Additional';
    add(extra.rate_limit, /spark/i.test(name) ? 'Codex Spark' : name);
  }
  const spend = data.spend_control?.individual_limit;
  if (spend) {
    const used = number(spend.used), limit = number(spend.limit);
    const percent = number(spend.used_percent) ?? (limit > 0 && used !== null ? used / limit * 100 : null);
    if (percent !== null) windows.push({ label: 'Monthly spend', usedPercent: percent, resetAt: resetTime(spend.reset_at) });
  }
  return { windows, plan: data.plan_type || null };
}

export function parseClaudeQuota(data) {
  const windows = [];
  for (const [field, label] of [['five_hour', 'Session'], ['seven_day', 'Weekly'], ['seven_day_oauth_apps', 'OAuth Apps'], ['seven_day_sonnet', 'Sonnet'], ['seven_day_opus', 'Opus']]) {
    const w = data[field];
    if (w && number(w.utilization) !== null) windows.push({ label, usedPercent: number(w.utilization), resetAt: w.resets_at || null });
  }
  for (const [fields, label] of [
    [['seven_day_design', 'seven_day_claude_design', 'claude_design', 'design', 'seven_day_omelette', 'omelette', 'omelette_promotional'], 'Designs'],
    [['seven_day_routines', 'seven_day_claude_routines', 'claude_routines', 'routines', 'routine', 'seven_day_cowork', 'cowork'], 'Daily Routines'],
  ]) {
    const w = fields.map(field => data[field]).find(Boolean);
    if (w && number(w.utilization) !== null) windows.push({ label, usedPercent: number(w.utilization), resetAt: w.resets_at || null });
  }
  const extra = data.extra_usage;
  const limit = number(extra?.monthly_limit), used = number(extra?.used_credits);
  const percent = number(extra?.utilization) ?? (limit > 0 && used !== null ? used / limit * 100 : null);
  if (extra?.is_enabled && percent !== null) windows.push({ label: 'Extra usage', usedPercent: percent, resetAt: null, used: used === null ? null : used / 100, limit: limit === null ? null : limit / 100, currency: extra.currency || 'USD' });
  return { windows };
}

export async function fetchQuota(provider, credentials, fetcher = fetch, signal, versionReader) {
  if (provider !== 'claude' && provider !== 'codex') throw new Error('Unsupported quota provider');
  if (!credentials?.accessToken) throw new Error('No OAuth access token available');
  const claude = provider === 'claude';
  const headers = { Authorization: `Bearer ${credentials.accessToken}`, Accept: 'application/json' };
  if (claude) {
    headers['anthropic-beta'] = 'oauth-2025-04-20';
    let version = '2.1.0';
    try {
      const reader = versionReader || (async () => (await execFileAsync('claude', ['--version'], { timeout: 1000, maxBuffer: 4096, signal })).stdout);
      const output = await reader();
      version = String(output).match(/\b\d+\.\d+\.\d+\b/)?.[0] || version;
    } catch {}
    signal?.throwIfAborted();
    headers['User-Agent'] = `claude-code/${version}`;
  } else if (credentials.accountId) {
    headers['ChatGPT-Account-Id'] = credentials.accountId;
  }
  const response = await fetcher(claude ? 'https://api.anthropic.com/api/oauth/usage' : 'https://chatgpt.com/backend-api/wham/usage', { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  if (response.status === 401 || response.status === 403) {
    throw new Error(claude ? 'Claude login is invalid or lacks access; run claude to log in again' : 'Codex login is invalid; run codex login');
  }
  if (!response.ok) throw new Error(`Quota request failed (HTTP ${response.status})`);
  const data = await response.json();
  const result = { provider, ...(claude ? parseClaudeQuota(data) : parseCodexQuota(data)) };
  if (!claude && credentials.idToken && credentials.idToken.length < 65536) {
    try {
      const claims = JSON.parse(Buffer.from(credentials.idToken.split('.')[1], 'base64url').toString('utf8'));
      if (typeof claims.email === 'string') result.email = claims.email;
      if (!result.plan && typeof claims['https://api.openai.com/auth']?.chatgpt_plan_type === 'string') result.plan = claims['https://api.openai.com/auth'].chatgpt_plan_type;
    } catch {}
  }
  return result;
}

export async function readCredentials(provider, env = process.env, options = {}) {
  if (provider === 'codex') {
    const file = join(env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
    const auth = JSON.parse(await readFile(file, 'utf8'));
    if (auth.OPENAI_API_KEY) throw new Error('OAuth usage limits require codex login');
    return { accessToken: auth.tokens?.access_token, refreshToken: auth.tokens?.refresh_token, idToken: auth.tokens?.id_token, accountId: auth.tokens?.account_id, lastRefresh: auth.last_refresh, authPath: file };
  }
  if (provider !== 'claude') throw new Error('Unsupported quota provider');
  const token = env.TOKCAT_CLAUDE_OAUTH_TOKEN || env.CODEXBAR_CLAUDE_OAUTH_TOKEN;
  if (token) return { accessToken: token };
  let raw;
  if ((options.platform || process.platform) === 'darwin') {
    const getKeychain = options.getKeychain || (async () => (await execFileAsync('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000, maxBuffer: 1024 * 1024, signal: options.signal })).stdout);
    try { raw = await getKeychain(); }
    catch (error) {
      if (options.signal?.aborted) throw error;
      if (error.killed || error.code === 'ETIMEDOUT') throw new Error('Claude Keychain access timed out; check the permission prompt');
    }
  }
  if (!raw) {
    const file = join(env.CLAUDE_HOME || join(homedir(), '.claude'), '.credentials.json');
    raw = await readFile(file, 'utf8');
  }
  const oauth = JSON.parse(raw).claudeAiOauth || {};
  if (oauth.expiresAt && oauth.expiresAt <= Date.now()) throw new Error('Claude token expired; run claude to refresh it');
  if (oauth.scopes && !oauth.scopes.includes('user:profile')) throw new Error('Claude login lacks user:profile scope');
  return { accessToken: oauth.accessToken };
}

export async function refreshCodexCredentials(path, fetcher = fetch, signal) {
  const original = await readFile(path, 'utf8');
  const auth = JSON.parse(original);
  if (!auth.tokens?.refresh_token) throw new Error('Codex refresh token unavailable; run codex login');
  const response = await fetcher('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: 'app_EMoamEEZ73f0CkXaXp7hrann', grant_type: 'refresh_token', refresh_token: auth.tokens.refresh_token, scope: 'openid profile email' }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Codex refresh failed; run codex login');
  const tokens = await response.json();
  if (!tokens.access_token) throw new Error('Codex refresh returned incomplete credentials; run codex login');
  auth.tokens = { ...auth.tokens, access_token: tokens.access_token, refresh_token: tokens.refresh_token || auth.tokens.refresh_token, ...(tokens.id_token ? { id_token: tokens.id_token } : {}) };
  auth.last_refresh = new Date().toISOString();
  const temp = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    const mode = (await stat(path)).mode & 0o600;
    handle = await open(temp, 'wx', mode || 0o600);
    await handle.writeFile(JSON.stringify(auth, null, 2));
    await handle.sync();
    await handle.close();
    handle = null;
    if (await readFile(path, 'utf8') !== original) throw new Error('Codex credentials changed during refresh; run codex login if needed');
    await rename(temp, path);
  } finally {
    if (handle) await handle.close();
    await unlink(temp).catch(() => {});
  }
  return { accessToken: auth.tokens.access_token, refreshToken: auth.tokens.refresh_token, idToken: auth.tokens.id_token, accountId: auth.tokens.account_id, lastRefresh: auth.last_refresh, authPath: path };
}

export async function collectQuotas(options = {}) {
  const read = options.read || ((provider) => readCredentials(provider, process.env, { signal: options.signal }));
  const refresh = options.refresh || ((path) => refreshCodexCredentials(path, fetch));
  const request = options.fetch || ((provider, credentials) => fetchQuota(provider, credentials, fetch, options.signal));
  return Promise.all(['claude', 'codex'].map(async (provider) => {
    try {
      let credentials = await read(provider);
      options.signal?.throwIfAborted();
      const refreshedAt = Date.parse(credentials.lastRefresh);
      if (provider === 'codex' && (!Number.isFinite(refreshedAt) || Date.now() - refreshedAt > 8 * 86400000)) {
        credentials = await refresh(credentials.authPath);
      }
      options.signal?.throwIfAborted();
      return await request(provider, credentials);
    } catch (error) {
      const safe = /^(Claude token expired|Claude login lacks|Claude login is invalid|Codex login is invalid|Claude Keychain access|OAuth usage limits|Codex refresh|Codex credentials changed|No OAuth access token|Quota request failed)/;
      const message = safe.test(error.message || '') ? error.message : 'Quota unavailable; check your login and network connection';
      return { provider, windows: [], error: message };
    }
  }));
}

export function renderQuota(quotas) {
  if (!quotas) return 'Loading quota information…';
  return quotas.map(({ provider, windows, error, email, plan }) => {
    const name = provider === 'claude' ? 'Claude' : 'Codex';
    const lines = error ? [error] : windows.length ? windows.map((w) => `${w.label}: ${w.usedPercent}% used${w.used != null && w.limit != null ? ` · ${w.currency} ${w.used.toFixed(2)} / ${w.limit.toFixed(2)}` : ''}${w.resetAt ? ` · resets ${w.resetAt}` : ''}`) : ['No quota windows available'];
    const identity = [email, plan].filter(Boolean).join(' · ');
    return `${name}${identity ? ` (${identity})` : ''}\n${lines.map((line) => `  ${line}`).join('\n')}`;
  }).join('\n\n').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '');
}

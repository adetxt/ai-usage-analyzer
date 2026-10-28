import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('report modes include mocked quotas only with --quota and never disclose tokens', () => {
  const home = mkdtempSync(join(tmpdir(), 'usage-cli-'));
  try {
    const codex = join(home, 'codex');
    mkdirSync(codex);
    writeFileSync(join(codex, 'auth.json'), JSON.stringify({ tokens: { access_token: 'fixture-codex-secret' }, last_refresh: new Date().toISOString() }));
    const mock = join(home, 'mock.mjs');
    writeFileSync(mock, `globalThis.fetch = async url => ({ ok: true, json: async () => String(url).includes('anthropic') ? { five_hour: { utilization: 25 } } : { rate_limit: { primary_window: { used_percent: 50, limit_window_seconds: 604800 } } } });`);
    const env = { ...process.env, HOME: home, CODEX_HOME: codex, CLAUDE_HOME: join(home, 'claude'), TOKCAT_CLAUDE_OAUTH_TOKEN: 'fixture-claude-secret', NODE_OPTIONS: `--import=${mock}`, AI_USAGE_PATHS_JSON: '{}' };
    const run = args => execFileSync(process.execPath, ['bin/ai-usage.js', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const plain = JSON.parse(run(['--json']));
    assert.equal('quotas' in plain, false);
    const raw = run(['--json', '--quota']);
    const report = JSON.parse(raw);
    assert.equal(report.quotas[0].windows[0].usedPercent, 25);
    assert.equal(report.quotas[1].windows[0].usedPercent, 50);
    assert.doesNotMatch(raw, /fixture-(claude|codex)-secret/);
    assert.match(run(['--md', '--quota']), /## Quotas[\s\S]*Session: 25%/);
    assert.match(run(['--static', '--quota']), /Weekly: 50%/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('JSON report without --quota makes no network requests', () => {
  const home = mkdtempSync(join(tmpdir(), 'usage-offline-'));
  try {
    const mock = join(home, 'offline.mjs');
    writeFileSync(mock, 'globalThis.fetch = () => { process.exit(97); };');
    const env = { ...process.env, HOME: home, CODEX_HOME: join(home, 'codex'), CLAUDE_HOME: join(home, 'claude'), NODE_OPTIONS: `--import=${mock}`, AI_USAGE_PATHS_JSON: '{}' };
    const output = execFileSync(process.execPath, ['bin/ai-usage.js', '--json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal('quotas' in JSON.parse(output), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

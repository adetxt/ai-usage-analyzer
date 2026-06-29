// Tests for src/tools.js — the single source of truth for per-tool config
// (color, bar char, label, path, count, etc.). Locks the shape so a stray
// field edit or removed tool gets caught here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOLS, TOOL_ORDER, getTool, getToolColor, getToolBarChar, getToolLabel,
} from '../src/tools.js';

test('TOOLS has exactly the 7 expected tool keys', () => {
  const expectedKeys = ['claude', 'codex', 'opencode', 'mimocode',
                        'copilot', 'antigravity', 'gemini'];
  const actualKeys = TOOLS.map(t => t.key);
  for (const k of expectedKeys) {
    assert.ok(actualKeys.includes(k), `missing tool: ${k}`);
  }
  assert.equal(TOOLS.length, 7, `expected 7 tools, got ${TOOLS.length}`);
});

test('TOOL_ORDER matches the order of TOOLS', () => {
  assert.deepEqual(TOOL_ORDER, TOOLS.map(t => t.key));
});

test('every tool has all required display fields', () => {
  for (const t of TOOLS) {
    assert.ok(typeof t.key === 'string' && t.key.length > 0, `${t.key}: key missing`);
    assert.ok(typeof t.name === 'string' && t.name.length > 0, `${t.key}: name missing`);
    assert.ok(typeof t.label === 'string' && t.label.length > 0, `${t.key}: label missing`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(t.color),
      `${t.key}: color must be a 6-digit hex string, got ${t.color}`);
    assert.ok(typeof t.barChar === 'string' && t.barChar.length > 0,
      `${t.key}: barChar missing`);
  }
});

test('every tool has all required detection fields', () => {
  for (const t of TOOLS) {
    assert.ok(typeof t.kind === 'string', `${t.key}: kind missing`);
    assert.equal(typeof t.hasTokens, 'boolean', `${t.key}: hasTokens must be boolean`);
    assert.ok(typeof t.envVar === 'string' && t.envVar.length > 0, `${t.key}: envVar missing`);
    assert.equal(typeof t.candidatePaths, 'function', `${t.key}: candidatePaths must be a function`);
    assert.equal(typeof t.count, 'function', `${t.key}: count must be a function`);
    assert.ok(typeof t.description === 'string' && t.description.length > 0,
      `${t.key}: description missing`);
  }
});

test('getToolColor returns the configured hex for each known tool', () => {
  const expected = {
    claude:      '#ff9e64',  // orange
    codex:       '#87ceeb',  // sky blue
    opencode:    '#f8f8f2',  // white
    mimocode:    '#f1fa8c',  // yellow
    copilot:     '#3b82f6',  // deep blue
    antigravity: '#ff5555',  // red
    gemini:      '#14b8a6',  // teal
  };
  for (const [key, hex] of Object.entries(expected)) {
    assert.equal(getToolColor(key), hex, `${key}: expected ${hex}, got ${getToolColor(key)}`);
  }
});

test('getToolBarChar returns the configured char for each known tool', () => {
  const expected = {
    claude:   '█',
    codex:    '▓',
    opencode: '▒',
    mimocode: '░',
  };
  for (const [key, ch] of Object.entries(expected)) {
    assert.equal(getToolBarChar(key), ch,
      `${key}: expected ${JSON.stringify(ch)}, got ${JSON.stringify(getToolBarChar(key))}`);
  }
});

test('getTool returns the full config object for known tools', () => {
  const claude = getTool('claude');
  assert.ok(claude, 'getTool("claude") returned null');
  assert.equal(claude.key, 'claude');
  assert.equal(claude.name, 'Claude Code');
  assert.equal(claude.color, '#ff9e64');
});

test('unknown tool keys return safe fallbacks', () => {
  assert.equal(getTool('not-a-real-tool'), null);
  assert.ok(/^#[0-9a-f]{6}$/i.test(getToolColor('nope')));
  assert.equal(typeof getToolBarChar('nope'), 'string');
  assert.equal(getToolLabel('nope'), 'nope');
});

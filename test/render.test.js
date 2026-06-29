// Tests for TUI color helpers.
// Locks the per-tool color mapping so a stray edit to tools.js gets caught
// here instead of slipping into a release unnoticed.
//
// We test toolColor() (the hex) rather than colorize() (the chalk output),
// because chalk's ANSI output depends on its detected color level and would
// be a fragile test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolColor } from '../src/render.js';

const EXPECTED = {
  claude:      '#ff9e64',  // orange
  codex:       '#87ceeb',  // sky blue
  opencode:    '#f8f8f2',  // white
  mimocode:    '#f1fa8c',  // yellow
  copilot:     '#3b82f6',  // deep blue
  antigravity: '#ff5555',  // red
  gemini:      '#14b8a6',  // teal
};

test('every known tool key maps to a 6-digit hex color', () => {
  for (const [key, hex] of Object.entries(EXPECTED)) {
    assert.equal(toolColor(key), hex, `${key}: expected color ${hex}, got ${toolColor(key)}`);
  }
});

test('unknown tool keys fall back to a hex color (not a name)', () => {
  const c = toolColor('not-a-real-tool');
  assert.ok(/^#[0-9a-f]{6}$/i.test(c), `expected hex fallback, got: ${c}`);
});

test('toolColor covers all 7 detector keys', () => {
  const expectedKeys = ['claude', 'codex', 'opencode', 'mimocode', 'copilot', 'antigravity', 'gemini'];
  for (const k of expectedKeys) {
    assert.ok(typeof toolColor(k) === 'string' && toolColor(k).length > 0, `missing color for ${k}`);
  }
});

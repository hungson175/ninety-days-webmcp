import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function runBrowser(mode) {
  const result = spawnSync(
    'python3',
    ['scripts/product_shell_browser_check.py', '--mode', mode],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

test('desktop product flow is complete with AI off and guarded submit', () => {
  const receipt = runBrowser('desktop');
  assert.equal(receipt.mode, 'desktop');
  assert.deepEqual(receipt.registry_counts, [4, 5, 6, 5]);
  assert.equal(receipt.submitted_simulation, true);
  assert.equal(receipt.model_context_injected, false);
  assert.equal(receipt.console_errors.length, 0);
});

test('mobile product has no horizontal overflow and keeps every core section readable', () => {
  const receipt = runBrowser('mobile');
  assert.equal(receipt.mode, 'mobile');
  assert.equal(receipt.viewport_width, 390);
  assert.equal(receipt.horizontal_overflow, 0);
  assert.deepEqual(receipt.missing_sections, []);
  assert.equal(receipt.console_errors.length, 0);
});

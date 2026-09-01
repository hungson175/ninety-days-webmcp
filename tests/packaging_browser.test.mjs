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

test('desktop package exposes one early origin meta and the complete fallback page', () => {
  const receipt = runBrowser('package-desktop');
  assert.equal(receipt.origin_meta_count, 1);
  assert.equal(receipt.meta_before_app, true);
  assert.equal(receipt.fallback_title, 'Ninety Days — make the window count');
  assert.equal(receipt.fallback_has_account, true);
  assert.deepEqual(receipt.console_errors, []);
});

test('mobile package preserves the cold manual product path', () => {
  const receipt = runBrowser('package-mobile');
  assert.equal(receipt.origin_meta_count, 1);
  assert.equal(receipt.horizontal_overflow, 0);
  assert.equal(receipt.countdown_days, '12');
  assert.equal(receipt.registry_count, '4');
  assert.deepEqual(receipt.console_errors, []);
});

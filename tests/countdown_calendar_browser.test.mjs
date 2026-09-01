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

for (const mode of ['calendar-desktop', 'calendar-mobile']) {
  test(`${mode} visibly closes the window and removes submit_exercise`, () => {
    const receipt = runBrowser(mode);
    assert.deepEqual(receipt.registry_counts, [4, 5, 6, 6, 5]);
    assert.equal(receipt.initial_days, '12');
    assert.equal(receipt.final_days, '0');
    assert.equal(receipt.final_clock, '00:00:00');
    assert.equal(receipt.final_countdown_status, 'WINDOW CLOSED');
    assert.equal(receipt.final_status, 'WINDOW CLOSED · SUBMIT REMOVED');
    assert.equal(receipt.submit_visible_before, true);
    assert.equal(receipt.submit_visible_after, false);
    assert.equal(receipt.closed_chip_visible, true);
    assert.equal(receipt.horizontal_overflow, 0);
    assert.deepEqual(receipt.console_errors, []);
  });
}

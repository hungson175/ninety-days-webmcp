import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createProductController } from '../src/app.mjs';

const root = new URL('../', import.meta.url);

test('makes the dated countdown and plan clause the visible decision headline', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /data-testid="countdown-days">12</);
  assert.match(html, /Advance past deadline/);
  assert.match(html, /Plan §6\.3 — the post-termination period starts on the last day worked\./);
  assert.match(html, /data-testid="countdown-window-status"[^>]*>ACTION WINDOW</);
  assert.match(html, /data-testid="window-closed-chip"[^>]*hidden/);
});

test('calendar expiry removes submit_exercise from the page-owned catalog', async () => {
  const controller = createProductController();
  await controller.model(4_263);
  await controller.prepare(4_263);
  assert.equal(controller.snapshot().windowOpen, true);
  assert.equal(controller.snapshot().toolNames.length, 6);
  assert.equal(controller.snapshot().toolNames.includes('submit_exercise'), true);

  await controller.advancePastDeadline();
  assert.equal(controller.snapshot().windowOpen, false);
  assert.equal(controller.snapshot().toolNames.length, 5);
  assert.equal(controller.snapshot().toolNames.includes('submit_exercise'), false);
});

test('a stale submit fails closed after the calendar deadline', async () => {
  const controller = createProductController();
  await controller.model(4_263);
  await controller.prepare(4_263);
  await controller.advancePastDeadline();
  assert.deepEqual(await controller.submit({ shares: 4_263, humanConfirmed: true }), {
    ok: false,
    reason: 'window_closed',
    message: 'Exercise submission is unavailable because the option window has closed.',
  });
});

test('the calendar transition is guarded by a trusted human event, not a tool', async () => {
  const app = await readFile(new URL('src/app.mjs', root), 'utf8');
  const catalog = await readFile(new URL('src/catalog.mjs', root), 'utf8');
  assert.match(app, /advancePastDeadline\(event\)/);
  assert.match(app, /event\.isTrusted/);
  assert.doesNotMatch(catalog, /advancePastDeadline|advance_past_deadline/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PRODUCT_FIXTURE,
  createProductController,
  formatCurrency,
  formatInteger,
} from '../src/app.mjs';

const root = new URL('../', import.meta.url);

test('ships a finished account shell with the source-corrected clock', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /NINETY DAYS/);
  assert.match(html, /EMP-4471/);
  assert.match(html, /18,400/);
  assert.match(html, /12 days/i);
  assert.match(html, /Plan §6\.3/);
  assert.match(html, /last day worked/i);
  assert.match(html, /3 months; plan date controls/i);
});

test('pins the visible derivation to the corrected 2026 integer-cent fixture', () => {
  assert.equal(PRODUCT_FIXTURE.taxProfile.taxYear, 2026);
  assert.equal(PRODUCT_FIXTURE.taxProfile.baselineAmtiCents, 18_000_000);
  assert.equal(PRODUCT_FIXTURE.primaryGrant.exercisePriceCents, 225);
  assert.equal(PRODUCT_FIXTURE.primaryGrant.fmvCents, 1_725);
  assert.equal(PRODUCT_FIXTURE.fullModel.cashCostCents, 4_140_000);
  assert.equal(PRODUCT_FIXTURE.fullModel.line2iAdjustmentProxyCents, 27_600_000);
  assert.equal(PRODUCT_FIXTURE.fullModel.tentativeMinimumTaxCents, 9_756_200);
  assert.equal(PRODUCT_FIXTURE.fullModel.modeledIncrementalAmtProxyCents, 5_756_200);
  assert.equal(PRODUCT_FIXTURE.crossover.shares, 4_263);
  assert.equal(formatCurrency(6_394_500), '$63,945.00');
  assert.equal(formatInteger(18_400), '18,400');
});

test('starts with four scoped tools and progressively reveals five then six', async () => {
  const controller = createProductController();
  assert.deepEqual(controller.snapshot().toolNames, [
    'list_grants',
    'get_plan_clause',
    'model_exercise',
    'find_amt_crossover',
  ]);
  const modeled = await controller.model(4_263);
  assert.equal(modeled.ok, true);
  assert.equal(controller.snapshot().toolNames.length, 5);
  const prepared = await controller.prepare(4_263);
  assert.equal(prepared.ok, true);
  assert.equal(controller.snapshot().toolNames.length, 6);
  assert.equal(controller.snapshot().toolNames.includes('submit_exercise'), true);
});

test('requires exact model then prepare and a human confirmation before simulated submit', async () => {
  const controller = createProductController();
  assert.equal((await controller.prepare(4_263)).reason, 'not_available');
  await controller.model(4_263);
  assert.equal((await controller.prepare(4_264)).reason, 'invalid_args');
  await controller.prepare(4_263);
  assert.equal((await controller.submit({ shares: 4_263, humanConfirmed: false })).reason, 'human_confirmation_required');
  const submitted = await controller.submit({ shares: 4_263, humanConfirmed: true });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.status, 'submitted_simulation');
  assert.equal(submitted.simulated, true);
});

test('deregisters submit during blackout and preserves the structured refusal', async () => {
  const controller = createProductController();
  await controller.model(4_263);
  await controller.prepare(4_263);
  controller.setBlackout(true);
  assert.equal(controller.snapshot().toolNames.length, 5);
  assert.equal(controller.snapshot().toolNames.includes('submit_exercise'), false);
  const refused = await controller.submit({ shares: 4_263, humanConfirmed: true });
  assert.deepEqual(refused, {
    ok: false,
    reason: 'blackout',
    message: 'Exercise submission is unavailable during the active blackout window.',
  });
});

test('renders the six-tool cap, source provenance, and synthetic boundary in product copy', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /Max 6 live tools/);
  assert.match(html, /webmachinelearning\/webmcp#255/);
  assert.match(html, /Rev\. Proc\. 2025-45/);
  assert.match(html, /Form 6251 line 2i/);
  assert.match(html, /not AMT owed/);
  assert.match(html, /not tax or legal advice/i);
  assert.doesNotMatch(html, /6,180/);
});

test('keeps grants in memory and contains no backend or financial transport', async () => {
  const app = await readFile(new URL('src/app.mjs', root), 'utf8');
  const pkg = await readFile(new URL('package.json', root), 'utf8');
  assert.doesNotMatch(app, /\bfetch\s*\(/);
  assert.doesNotMatch(app, /localStorage/);
  assert.doesNotMatch(app, /\bwire\b|brokerage|Fidelity|Carta API/i);
  assert.doesNotMatch(pkg, /express|next|firebase/i);
});

test('defines responsive financial-product styling rather than a debug console', async () => {
  const css = await readFile(new URL('styles.css', root), 'utf8');
  assert.match(css, /--ink:/);
  assert.match(css, /--paper:/);
  assert.match(css, /--accent:/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /overflow-wrap:/);
});

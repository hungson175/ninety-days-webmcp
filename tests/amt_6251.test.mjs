import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MODEL_BOUNDARY,
  computeExemptionCents,
  computeExerciseModel,
  computeLine2iProxyCents,
  computeTentativeMinimumTaxCents,
  findAmtCrossover,
} from '../src/tax/amt_6251.mjs';

const syntheticFixture = {
  taxYear: 2026,
  filingStatus: 'single',
  baselineAmtiCents: 18_000_000,
  regularTaxCents: 4_000_000,
  exercisePriceCents: 225,
  fmvCents: 1_725,
  vestedShares: 18_400,
  sameYearDisposition: false,
};

test('uses the 2026 exemption and 50 percent phaseout table', () => {
  assert.equal(computeExemptionCents({ taxYear: 2026, filingStatus: 'single', amtiCents: 50_000_000 }), 9_010_000);
  assert.equal(computeExemptionCents({ taxYear: 2026, filingStatus: 'single', amtiCents: 59_010_000 }), 4_505_000);
  assert.equal(computeExemptionCents({ taxYear: 2026, filingStatus: 'single', amtiCents: 68_020_000 }), 0);
  assert.equal(computeExemptionCents({ taxYear: 2026, filingStatus: 'joint', amtiCents: 100_000_000 }), 14_020_000);
  assert.equal(computeExemptionCents({ taxYear: 2026, filingStatus: 'joint', amtiCents: 128_040_000 }), 0);
});

test('applies 26 percent then 28 percent above the 2026 breakpoint', () => {
  assert.equal(
    computeTentativeMinimumTaxCents({
      taxYear: 2026,
      filingStatus: 'single',
      excessTaxableIncomeCents: 24_450_000,
    }),
    6_357_000,
  );
  assert.equal(
    computeTentativeMinimumTaxCents({
      taxYear: 2026,
      filingStatus: 'single',
      excessTaxableIncomeCents: 24_450_100,
    }),
    6_357_028,
  );
});

test('computes the line 2i adjustment proxy in integer cents', () => {
  assert.equal(
    computeLine2iProxyCents({
      shares: 18_400,
      exercisePriceCents: 225,
      fmvCents: 1_725,
      sameYearDisposition: false,
    }),
    27_600_000,
  );
  assert.equal(
    computeLine2iProxyCents({
      shares: 18_400,
      exercisePriceCents: 225,
      fmvCents: 1_725,
      sameYearDisposition: true,
    }),
    0,
  );
});

test('matches the source-corrected full-exercise synthetic fixture', () => {
  const model = computeExerciseModel({ ...syntheticFixture, shares: 18_400 });
  assert.deepEqual(model, {
    taxYear: 2026,
    filingStatus: 'single',
    shares: 18_400,
    cashCostCents: 4_140_000,
    line2iAdjustmentProxyCents: 27_600_000,
    amtiCents: 45_600_000,
    exemptionCents: 9_010_000,
    excessTaxableIncomeCents: 36_590_000,
    tentativeMinimumTaxCents: 9_756_200,
    modeledIncrementalAmtProxyCents: 5_756_200,
  });
  assert.equal(model.modeledIncrementalAmtProxyCents > model.cashCostCents, true);
});

test('finds the exact last share count with zero modeled incremental proxy', () => {
  const crossover = findAmtCrossover(syntheticFixture);
  assert.equal(crossover.shares, 4_263);
  assert.equal(crossover.probes <= 15, true);
  assert.equal(crossover.model.modeledIncrementalAmtProxyCents, 0);
  assert.equal(crossover.model.line2iAdjustmentProxyCents, 6_394_500);
  assert.equal(crossover.model.tentativeMinimumTaxCents, 3_999_970);

  const next = computeExerciseModel({ ...syntheticFixture, shares: 4_264 });
  assert.equal(next.line2iAdjustmentProxyCents, 6_396_000);
  assert.equal(next.tentativeMinimumTaxCents, 4_000_360);
  assert.equal(next.modeledIncrementalAmtProxyCents, 360);
});

test('refuses unsupported years and incomplete disposition facts', () => {
  assert.throws(
    () => computeExerciseModel({ ...syntheticFixture, shares: 100, taxYear: 2025 }),
    /taxYear must be 2026/,
  );
  assert.throws(
    () => computeExerciseModel({ ...syntheticFixture, shares: 100, sameYearDisposition: undefined }),
    /sameYearDisposition must be boolean/,
  );
  assert.throws(
    () => computeExerciseModel({ ...syntheticFixture, shares: 18_401 }),
    /shares must be an integer between 0 and 18400/,
  );
});

test('exports the exact synthetic and source boundary for the UI', () => {
  assert.equal(MODEL_BOUNDARY.toLowerCase().includes('synthetic 2026'), true);
  assert.equal(MODEL_BOUNDARY.includes('Form 6251 line 2i'), true);
  assert.equal(MODEL_BOUNDARY.includes('not AMT owed'), true);
  assert.equal(MODEL_BOUNDARY.includes('3 months'), true);
  assert.equal(MODEL_BOUNDARY.includes('90 days'), false);
});

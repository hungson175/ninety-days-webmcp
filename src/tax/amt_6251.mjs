const TAX_2026 = Object.freeze({
  single: Object.freeze({
    exemptionCents: 9_010_000,
    phaseoutStartsCents: 50_000_000,
    phaseoutCompletesCents: 68_020_000,
    rateBreakpointCents: 24_450_000,
  }),
  joint: Object.freeze({
    exemptionCents: 14_020_000,
    phaseoutStartsCents: 100_000_000,
    phaseoutCompletesCents: 128_040_000,
    rateBreakpointCents: 24_450_000,
  }),
  separate: Object.freeze({
    exemptionCents: 7_010_000,
    phaseoutStartsCents: 50_000_000,
    phaseoutCompletesCents: 64_020_000,
    rateBreakpointCents: 12_225_000,
  }),
});

export const MODEL_BOUNDARY =
  'Synthetic 2026 federal ordinary-income model. Form 6251 line 2i AMT adjustment proxy — not AMT owed. The statute uses 3 months; the plan date controls.';

function requireTaxYear(taxYear) {
  if (taxYear !== 2026) throw new RangeError('taxYear must be 2026');
}

function requireFilingStatus(filingStatus) {
  const status = TAX_2026[filingStatus];
  if (!status) throw new TypeError('filingStatus must be single, joint, or separate');
  return status;
}

function requireCents(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a nonnegative safe integer number of cents`);
  }
}

export function computeExemptionCents({ taxYear, filingStatus, amtiCents }) {
  requireTaxYear(taxYear);
  const status = requireFilingStatus(filingStatus);
  requireCents('amtiCents', amtiCents);
  if (amtiCents <= status.phaseoutStartsCents) return status.exemptionCents;
  if (amtiCents >= status.phaseoutCompletesCents) return 0;

  const reductionCents = Math.floor((amtiCents - status.phaseoutStartsCents) / 2);
  return Math.max(0, status.exemptionCents - reductionCents);
}

export function computeTentativeMinimumTaxCents({
  taxYear,
  filingStatus,
  excessTaxableIncomeCents,
}) {
  requireTaxYear(taxYear);
  const status = requireFilingStatus(filingStatus);
  requireCents('excessTaxableIncomeCents', excessTaxableIncomeCents);
  const firstBandCents = Math.min(excessTaxableIncomeCents, status.rateBreakpointCents);
  const secondBandCents = Math.max(0, excessTaxableIncomeCents - status.rateBreakpointCents);
  const weightedNumerator = firstBandCents * 26 + secondBandCents * 28;
  if (!Number.isSafeInteger(weightedNumerator)) {
    throw new RangeError('tax calculation exceeds safe integer bounds');
  }
  return Math.floor((weightedNumerator + 50) / 100);
}

export function computeLine2iProxyCents({
  shares,
  exercisePriceCents,
  fmvCents,
  sameYearDisposition,
}) {
  if (!Number.isSafeInteger(shares) || shares < 0) {
    throw new TypeError('shares must be a nonnegative safe integer');
  }
  requireCents('exercisePriceCents', exercisePriceCents);
  requireCents('fmvCents', fmvCents);
  if (typeof sameYearDisposition !== 'boolean') {
    throw new TypeError('sameYearDisposition must be boolean');
  }
  if (sameYearDisposition) return 0;
  const spreadCents = Math.max(0, fmvCents - exercisePriceCents);
  const proxyCents = spreadCents * shares;
  if (!Number.isSafeInteger(proxyCents)) throw new RangeError('line 2i proxy exceeds safe integer bounds');
  return proxyCents;
}

function validateFixture(fixture, shares) {
  requireTaxYear(fixture.taxYear);
  requireFilingStatus(fixture.filingStatus);
  requireCents('baselineAmtiCents', fixture.baselineAmtiCents);
  requireCents('regularTaxCents', fixture.regularTaxCents);
  requireCents('exercisePriceCents', fixture.exercisePriceCents);
  requireCents('fmvCents', fixture.fmvCents);
  if (!Number.isSafeInteger(fixture.vestedShares) || fixture.vestedShares < 1) {
    throw new TypeError('vestedShares must be a positive safe integer');
  }
  if (!Number.isSafeInteger(shares) || shares < 0 || shares > fixture.vestedShares) {
    throw new RangeError(`shares must be an integer between 0 and ${fixture.vestedShares}`);
  }
  if (typeof fixture.sameYearDisposition !== 'boolean') {
    throw new TypeError('sameYearDisposition must be boolean');
  }
}

export function computeExerciseModel(fixture) {
  validateFixture(fixture, fixture.shares);
  const {
    taxYear,
    filingStatus,
    shares,
    baselineAmtiCents,
    regularTaxCents,
    exercisePriceCents,
    fmvCents,
    sameYearDisposition,
  } = fixture;
  const cashCostCents = exercisePriceCents * shares;
  if (!Number.isSafeInteger(cashCostCents)) throw new RangeError('cash cost exceeds safe integer bounds');
  const line2iAdjustmentProxyCents = computeLine2iProxyCents({
    shares,
    exercisePriceCents,
    fmvCents,
    sameYearDisposition,
  });
  const amtiCents = baselineAmtiCents + line2iAdjustmentProxyCents;
  if (!Number.isSafeInteger(amtiCents)) throw new RangeError('AMTI exceeds safe integer bounds');
  const exemptionCents = computeExemptionCents({ taxYear, filingStatus, amtiCents });
  const excessTaxableIncomeCents = Math.max(0, amtiCents - exemptionCents);
  const tentativeMinimumTaxCents = computeTentativeMinimumTaxCents({
    taxYear,
    filingStatus,
    excessTaxableIncomeCents,
  });
  const modeledIncrementalAmtProxyCents = Math.max(
    0,
    tentativeMinimumTaxCents - regularTaxCents,
  );
  return {
    taxYear,
    filingStatus,
    shares,
    cashCostCents,
    line2iAdjustmentProxyCents,
    amtiCents,
    exemptionCents,
    excessTaxableIncomeCents,
    tentativeMinimumTaxCents,
    modeledIncrementalAmtProxyCents,
  };
}

export function findAmtCrossover(fixture) {
  validateFixture(fixture, 0);
  const modelAt = (shares) => computeExerciseModel({ ...fixture, shares });
  const zero = modelAt(0);
  if (zero.modeledIncrementalAmtProxyCents > 0) {
    return { shares: 0, probes: 0, alreadyAboveThreshold: true, model: zero };
  }
  const vested = modelAt(fixture.vestedShares);
  if (vested.modeledIncrementalAmtProxyCents === 0) {
    return {
      shares: fixture.vestedShares,
      probes: 0,
      alreadyAboveThreshold: false,
      model: vested,
    };
  }

  let low = 0;
  let high = fixture.vestedShares;
  let probes = 0;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    const model = modelAt(middle);
    probes += 1;
    if (model.modeledIncrementalAmtProxyCents === 0) low = middle;
    else high = middle - 1;
  }
  return { shares: low, probes, alreadyAboveThreshold: false, model: modelAt(low) };
}

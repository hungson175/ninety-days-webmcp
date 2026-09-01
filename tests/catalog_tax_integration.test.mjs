import assert from 'node:assert/strict';
import test from 'node:test';

import { createEquitySession, executeSessionTool, getSessionCatalog } from '../src/catalog.mjs';

const grants = [
  {
    grantId: 'EMP-4471',
    vestedShares: 18_400,
    daysRemaining: 12,
    exercisePriceCents: 225,
    fmvCents: 1_725,
    sameYearDisposition: false,
    planClause:
      'Plan §6.3 — the post-termination period starts on the last day worked. The plan deadline controls.',
  },
];

const taxProfile = {
  taxYear: 2026,
  filingStatus: 'single',
  baselineAmtiCents: 18_000_000,
  regularTaxCents: 4_000_000,
};

test('model_exercise returns the exact source-pinned synthetic derivation', async () => {
  const session = createEquitySession({ grants, taxProfile });
  const result = await executeSessionTool(session, 'model_exercise', {
    grant_id: 'EMP-4471',
    shares: 18_400,
  });

  assert.equal(result.ok, true);
  assert.equal(result.binding, false);
  assert.equal(result.synthetic, true);
  assert.equal(result.cash_cost_cents, 4_140_000);
  assert.equal(result.line_2i_adjustment_proxy_cents, 27_600_000);
  assert.equal(result.tentative_minimum_tax_cents, 9_756_200);
  assert.equal(result.modeled_incremental_amt_proxy_cents, 5_756_200);
  assert.deepEqual(result.provenance, [
    '26 U.S.C. §56(a)(3)',
    'Form 6251 line 2i (2025 instructions)',
    'Rev. Proc. 2025-45 §§3.10–3.11 (2026 indexed values)',
  ]);
  assert.equal(getSessionCatalog(session).some(({ name }) => name === 'prepare_exercise'), true);
});

test('find_amt_crossover returns the last zero-proxy share and the next-share boundary', async () => {
  const session = createEquitySession({ grants, taxProfile });
  const result = await executeSessionTool(session, 'find_amt_crossover', {
    grant_id: 'EMP-4471',
  });

  assert.equal(result.ok, true);
  assert.equal(result.synthetic, true);
  assert.equal(result.crossover_shares, 4_263);
  assert.equal(result.cash_cost_cents, 959_175);
  assert.equal(result.line_2i_adjustment_proxy_cents, 6_394_500);
  assert.equal(result.modeled_incremental_amt_proxy_cents, 0);
  assert.equal(result.next_share.modeled_incremental_amt_proxy_cents, 360);
  assert.equal(result.probes <= 15, true);
});

test('plan tool uses three-month source wording without claiming universal cancellation', async () => {
  const session = createEquitySession({ grants, taxProfile });
  const result = await executeSessionTool(session, 'get_plan_clause', {
    grant_id: 'EMP-4471',
  });

  assert.equal(result.ok, true);
  assert.equal(result.clause.includes('plan deadline controls'), true);
  assert.equal(result.statute, '26 U.S.C. §422(a)(2): employee status through the day 3 months before exercise');
  assert.equal(result.caveat.includes('ISO qualification may be lost'), true);
  assert.equal(result.caveat.includes('void'), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEquitySession,
  executeSessionTool,
  getSessionCatalog,
  mintGrantIdEnum,
} from '../src/catalog.mjs';

const grants = [
  {
    grantId: 'EMP-4471',
    vestedShares: 18_400,
    daysRemaining: 12,
    planClause: 'Plan §6.3 — the post-termination period starts on the last day worked.',
  },
  {
    grantId: 'EMP-4482',
    vestedShares: 2_000,
    daysRemaining: 87,
    planClause: 'Plan §6.3 — the post-termination period starts on the last day worked.',
  },
];

function names(session) {
  return getSessionCatalog(session).map((tool) => tool.name);
}

test('mints a closed runtime grant_id enum from the live grant set', () => {
  assert.deepEqual(mintGrantIdEnum(grants), ['EMP-4471', 'EMP-4482']);
  assert.throws(
    () => mintGrantIdEnum([{ grantId: '__proto__' }]),
    /invalid grant id/i,
  );
});

test('catalog schemas reject a hallucinated grant id before execution', async () => {
  const session = createEquitySession({ grants });
  const planTool = getSessionCatalog(session).find((tool) => tool.name === 'get_plan_clause');

  assert.deepEqual(planTool.inputSchema.properties.grant_id.enum, ['EMP-4471', 'EMP-4482']);
  assert.deepEqual(await executeSessionTool(session, 'get_plan_clause', { grant_id: 'FAKE-9999' }), {
    ok: false,
    reason: 'invalid_args',
    message: 'grant_id must be one of: EMP-4471, EMP-4482',
  });
});

test('never exposes more than six tools and reveals guarded writes progressively', async () => {
  const session = createEquitySession({ grants });
  assert.deepEqual(names(session), [
    'list_grants',
    'get_plan_clause',
    'model_exercise',
    'find_amt_crossover',
  ]);

  assert.deepEqual(
    await executeSessionTool(session, 'prepare_exercise', {
      grant_id: 'EMP-4471',
      shares: 6_180,
    }),
    { ok: false, reason: 'not_available', message: 'prepare_exercise is not registered' },
  );

  const modeled = await executeSessionTool(session, 'model_exercise', {
    grant_id: 'EMP-4471',
    shares: 6_180,
  });
  assert.equal(modeled.ok, true);
  assert.equal(names(session).includes('prepare_exercise'), true);

  const prepared = await executeSessionTool(session, 'prepare_exercise', {
    grant_id: 'EMP-4471',
    shares: 6_180,
  });
  assert.equal(prepared.ok, true);
  assert.equal(names(session).includes('submit_exercise'), true);
  assert.equal(names(session).length, 6);
});

test('blackout removes submit_exercise without weakening the execution guard', async () => {
  const session = createEquitySession({ grants });
  await executeSessionTool(session, 'model_exercise', {
    grant_id: 'EMP-4471',
    shares: 6_180,
  });
  await executeSessionTool(session, 'prepare_exercise', {
    grant_id: 'EMP-4471',
    shares: 6_180,
  });
  assert.equal(names(session).includes('submit_exercise'), true);

  session.setBlackout(true);
  assert.equal(names(session).includes('submit_exercise'), false);
  assert.equal(names(session).length, 5);
  assert.deepEqual(
    await executeSessionTool(session, 'submit_exercise', {
      grant_id: 'EMP-4471',
      shares: 6_180,
    }),
    {
      ok: false,
      reason: 'blackout',
      message: 'Exercise submission is unavailable during the active blackout window.',
    },
  );
});

test('aborted calls do not mutate model or prepared state', async () => {
  const session = createEquitySession({ grants });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    executeSessionTool(
      session,
      'model_exercise',
      { grant_id: 'EMP-4471', shares: 6_180 },
      { signal: controller.signal },
    ),
    { name: 'AbortError' },
  );
  assert.deepEqual(names(session), [
    'list_grants',
    'get_plan_clause',
    'model_exercise',
    'find_amt_crossover',
  ]);
});

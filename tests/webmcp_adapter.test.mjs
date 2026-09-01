import assert from 'node:assert/strict';
import test from 'node:test';

import { createEquitySession, executeSessionTool } from '../src/catalog.mjs';
import { stopSessionWebMCP, syncSessionWebMCP } from '../src/webmcp_adapter.mjs';

const grants = [
  {
    grantId: 'EMP-4471',
    vestedShares: 18_400,
    daysRemaining: 12,
    planClause: 'Plan §6.3 — the period starts on the last day worked.',
  },
  {
    grantId: 'EMP-4482',
    vestedShares: 2_000,
    daysRemaining: 87,
    planClause: 'Plan §6.3 — the period starts on the last day worked.',
  },
];

class FakeModelContext {
  registrations = [];

  async registerTool(descriptor, { signal } = {}) {
    if (signal?.aborted) throw new DOMException('registration aborted', 'AbortError');
    this.registrations.push({ descriptor, signal });
  }

  activeTools() {
    return this.registrations
      .filter(({ signal }) => !signal.aborted)
      .map(({ descriptor }) => descriptor);
  }
}

test('re-registers the exact progressive catalog and aborts stale registrations', async () => {
  const modelContext = new FakeModelContext();
  const documentRef = { modelContext };
  const session = createEquitySession({ grants });

  let receipt = await syncSessionWebMCP({ documentRef, session });
  assert.deepEqual(receipt.registered, [
    'list_grants',
    'get_plan_clause',
    'model_exercise',
    'find_amt_crossover',
  ]);
  assert.equal(modelContext.activeTools().length, 4);
  const staleSignals = modelContext.activeTools().map(({ execute }) => execute).length;
  assert.equal(staleSignals, 4);

  await executeSessionTool(session, 'model_exercise', {
    grant_id: 'EMP-4471',
    shares: 6_180,
  });
  receipt = await syncSessionWebMCP({ documentRef, session });
  assert.equal(modelContext.activeTools().length, 5);
  assert.equal(receipt.registered.at(-1), 'prepare_exercise');

  await executeSessionTool(session, 'prepare_exercise', {
    grant_id: 'EMP-4471',
    shares: 6_180,
  });
  receipt = await syncSessionWebMCP({ documentRef, session });
  assert.equal(modelContext.activeTools().length, 6);
  assert.equal(receipt.registered.at(-1), 'submit_exercise');

  session.setBlackout(true);
  receipt = await syncSessionWebMCP({ documentRef, session });
  assert.equal(modelContext.activeTools().length, 5);
  assert.equal(receipt.registered.includes('submit_exercise'), false);
});

test('descriptors carry the runtime enum and execute through the session guard', async () => {
  const modelContext = new FakeModelContext();
  const session = createEquitySession({ grants });
  await syncSessionWebMCP({ documentRef: { modelContext }, session });

  const planTool = modelContext.activeTools().find(({ name }) => name === 'get_plan_clause');
  assert.deepEqual(planTool.inputSchema.properties.grant_id.enum, ['EMP-4471', 'EMP-4482']);
  assert.equal((await planTool.execute({ grant_id: 'EMP-4471' })).ok, true);
  assert.equal((await planTool.execute({ grant_id: 'FAKE-9999' })).reason, 'invalid_args');

  stopSessionWebMCP();
  assert.equal(modelContext.activeTools().length, 0);
});

test('fails closed and rolls back every registration when one registration fails', async () => {
  const modelContext = new FakeModelContext();
  const original = modelContext.registerTool.bind(modelContext);
  let calls = 0;
  modelContext.registerTool = async (...args) => {
    calls += 1;
    if (calls === 3) throw new DOMException('registration failed', 'SecurityError');
    return original(...args);
  };

  await assert.rejects(
    syncSessionWebMCP({ documentRef: { modelContext }, session: createEquitySession({ grants }) }),
    { name: 'SecurityError' },
  );
  assert.equal(modelContext.activeTools().length, 0);
});

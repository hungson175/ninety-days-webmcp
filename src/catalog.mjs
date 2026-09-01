import { computeExerciseModel, findAmtCrossover, MODEL_BOUNDARY } from './tax/amt_6251.mjs';

const SAFE_GRANT_ID = /^[A-Z0-9-]{2,20}$/;
const UNSAFE_GRANT_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_GRANTS = 12;
const MAX_LIVE_TOOLS = 6;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function invalidArgs(message) {
  return { ok: false, reason: 'invalid_args', message };
}

function abortError() {
  return new DOMException('The tool call was aborted.', 'AbortError');
}

export function mintGrantIdEnum(grants) {
  if (!Array.isArray(grants) || grants.length === 0 || grants.length > MAX_GRANTS) {
    throw new TypeError(`grants must contain between 1 and ${MAX_GRANTS} entries`);
  }

  const ids = grants.map((grant) => grant?.grantId);
  for (const id of ids) {
    if (typeof id !== 'string' || UNSAFE_GRANT_IDS.has(id) || !SAFE_GRANT_ID.test(id)) {
      throw new TypeError(`invalid grant id: ${String(id)}`);
    }
  }
  if (new Set(ids).size !== ids.length) {
    throw new TypeError('invalid grant id: duplicate values are not allowed');
  }
  return ids.toSorted();
}

function grantSchema(grantIds, extraProperties = {}, extraRequired = []) {
  return {
    type: 'object',
    properties: {
      grant_id: { type: 'string', enum: [...grantIds] },
      ...extraProperties,
    },
    required: ['grant_id', ...extraRequired],
    additionalProperties: false,
  };
}

function descriptor(name, title, description, inputSchema, readOnlyHint = true) {
  return {
    name,
    title,
    description,
    inputSchema,
    annotations: { readOnlyHint },
  };
}

export function createEquitySession({
  grants,
  taxProfile = null,
  blackout = false,
  windowOpen = true,
}) {
  const grantIds = mintGrantIdEnum(grants);
  const state = {
    grants: clone(grants),
    grantIds,
    taxProfile: taxProfile ? clone(taxProfile) : null,
    blackout: Boolean(blackout),
    windowOpen: Boolean(windowOpen),
    modeled: null,
    prepared: null,
  };

  return {
    _state: state,
    setBlackout(value) {
      state.blackout = Boolean(value);
    },
    setWindowOpen(value) {
      state.windowOpen = Boolean(value);
    },
    snapshot() {
      return clone(state);
    },
  };
}

export function getSessionCatalog(session) {
  const state = session?._state;
  if (!state) throw new TypeError('a valid equity session is required');
  const shareProperties = { shares: { type: 'integer', minimum: 1 } };
  const shareRequired = ['shares'];
  const tools = [
    descriptor(
      'list_grants',
      'List expiring grants',
      'List grant references, vested shares, and days remaining without dumping account data.',
      { type: 'object', properties: {}, additionalProperties: false },
    ),
    descriptor(
      'get_plan_clause',
      'Quote plan deadline clause',
      'Return the verbatim page-owned plan clause governing the post-termination clock.',
      grantSchema(state.grantIds),
    ),
    descriptor(
      'model_exercise',
      'Model an exercise',
      'Create a non-binding model receipt for an exact grant and share count.',
      grantSchema(state.grantIds, shareProperties, shareRequired),
    ),
    descriptor(
      'find_amt_crossover',
      'Find AMT crossover',
      'Find the maximum modeled share count that stays below the configured AMT threshold.',
      grantSchema(state.grantIds),
    ),
  ];

  if (state.modeled) {
    tools.push(
      descriptor(
        'prepare_exercise',
        'Prepare exercise order',
        'Prepare the exact previously modeled grant and share count without submitting it.',
        grantSchema(state.grantIds, shareProperties, shareRequired),
        false,
      ),
    );
  }
  if (state.prepared && state.windowOpen && !state.blackout) {
    tools.push(
      descriptor(
        'submit_exercise',
        'Submit simulated exercise',
        'Execute the prepared order only while every page-owned invariant remains true.',
        grantSchema(state.grantIds, shareProperties, shareRequired),
        false,
      ),
    );
  }
  if (tools.length > MAX_LIVE_TOOLS) {
    throw new RangeError(`tool catalog exceeds the ${MAX_LIVE_TOOLS}-tool live cap`);
  }
  return tools;
}

function validateGrantAndShares(state, input, sharesRequired = false) {
  const grantId = input?.grant_id;
  if (!state.grantIds.includes(grantId)) {
    return invalidArgs(`grant_id must be one of: ${state.grantIds.join(', ')}`);
  }
  const grant = state.grants.find((candidate) => candidate.grantId === grantId);
  if (sharesRequired) {
    if (!Number.isSafeInteger(input?.shares) || input.shares < 1 || input.shares > grant.vestedShares) {
      return invalidArgs(`shares must be an integer between 1 and ${grant.vestedShares}`);
    }
  }
  return { ok: true, grant };
}

export async function executeSessionTool(session, name, input = {}, { signal } = {}) {
  const state = session?._state;
  if (!state) throw new TypeError('a valid equity session is required');
  if (signal?.aborted) throw abortError();

  const available = new Set(getSessionCatalog(session).map((tool) => tool.name));
  if (!available.has(name)) {
    if (name === 'submit_exercise' && !state.windowOpen) {
      return {
        ok: false,
        reason: 'window_closed',
        message: 'Exercise submission is unavailable because the option window has closed.',
      };
    }
    if (name === 'submit_exercise' && state.blackout) {
      return {
        ok: false,
        reason: 'blackout',
        message: 'Exercise submission is unavailable during the active blackout window.',
      };
    }
    return { ok: false, reason: 'not_available', message: `${name} is not registered` };
  }

  if (name === 'list_grants') {
    return {
      ok: true,
      grants: state.grants.map(({ grantId, vestedShares, daysRemaining }) => ({
        grant_id: grantId,
        vested_shares: vestedShares,
        days_remaining: daysRemaining,
      })),
    };
  }

  const validation = validateGrantAndShares(
    state,
    input,
    name === 'model_exercise' || name === 'prepare_exercise' || name === 'submit_exercise',
  );
  if (!validation.ok) return validation;

  if (name === 'get_plan_clause') {
    return {
      ok: true,
      grant_id: input.grant_id,
      clause: validation.grant.planClause,
      statute:
        '26 U.S.C. §422(a)(2): employee status through the day 3 months before exercise',
      caveat:
        'ISO qualification may be lost; plan rights and possible nonstatutory treatment require verification.',
    };
  }
  if (name === 'find_amt_crossover') {
    if (!state.taxProfile || !Number.isSafeInteger(validation.grant.exercisePriceCents) || !Number.isSafeInteger(validation.grant.fmvCents)) {
      return { ok: true, grant_id: input.grant_id, status: 'tax_kernel_pending' };
    }
    const fixture = {
      ...state.taxProfile,
      exercisePriceCents: validation.grant.exercisePriceCents,
      fmvCents: validation.grant.fmvCents,
      vestedShares: validation.grant.vestedShares,
      sameYearDisposition: validation.grant.sameYearDisposition,
    };
    const crossover = findAmtCrossover(fixture);
    const nextShare = Math.min(validation.grant.vestedShares, crossover.shares + 1);
    const nextModel = computeExerciseModel({ ...fixture, shares: nextShare });
    return {
      ok: true,
      synthetic: true,
      grant_id: input.grant_id,
      crossover_shares: crossover.shares,
      cash_cost_cents: crossover.model.cashCostCents,
      line_2i_adjustment_proxy_cents: crossover.model.line2iAdjustmentProxyCents,
      modeled_incremental_amt_proxy_cents:
        crossover.model.modeledIncrementalAmtProxyCents,
      probes: crossover.probes,
      next_share: {
        shares: nextShare,
        modeled_incremental_amt_proxy_cents: nextModel.modeledIncrementalAmtProxyCents,
      },
      boundary: MODEL_BOUNDARY,
    };
  }
  if (name === 'model_exercise') {
    state.modeled = { grantId: input.grant_id, shares: input.shares };
    state.prepared = null;
    if (
      state.taxProfile
      && Number.isSafeInteger(validation.grant.exercisePriceCents)
      && Number.isSafeInteger(validation.grant.fmvCents)
    ) {
      const model = computeExerciseModel({
        ...state.taxProfile,
        exercisePriceCents: validation.grant.exercisePriceCents,
        fmvCents: validation.grant.fmvCents,
        vestedShares: validation.grant.vestedShares,
        sameYearDisposition: validation.grant.sameYearDisposition,
        shares: input.shares,
      });
      return {
        ok: true,
        status: 'modeled',
        grant_id: input.grant_id,
        shares: input.shares,
        binding: false,
        synthetic: true,
        cash_cost_cents: model.cashCostCents,
        line_2i_adjustment_proxy_cents: model.line2iAdjustmentProxyCents,
        tentative_minimum_tax_cents: model.tentativeMinimumTaxCents,
        modeled_incremental_amt_proxy_cents: model.modeledIncrementalAmtProxyCents,
        boundary: MODEL_BOUNDARY,
        provenance: [
          '26 U.S.C. §56(a)(3)',
          'Form 6251 line 2i (2025 instructions)',
          'Rev. Proc. 2025-45 §§3.10–3.11 (2026 indexed values)',
        ],
      };
    }
    return {
      ok: true,
      status: 'modeled',
      grant_id: input.grant_id,
      shares: input.shares,
      binding: false,
    };
  }
  if (name === 'prepare_exercise') {
    if (state.modeled.grantId !== input.grant_id || state.modeled.shares !== input.shares) {
      return invalidArgs('prepare_exercise must exactly match the latest model_exercise receipt');
    }
    state.prepared = { grantId: input.grant_id, shares: input.shares };
    return {
      ok: true,
      status: 'prepared',
      grant_id: input.grant_id,
      shares: input.shares,
      binding: false,
    };
  }

  if (state.prepared.grantId !== input.grant_id || state.prepared.shares !== input.shares) {
    return invalidArgs('submit_exercise must exactly match the prepared order');
  }
  return {
    ok: true,
    status: 'submitted_simulation',
    grant_id: input.grant_id,
    shares: input.shares,
    simulated: true,
  };
}

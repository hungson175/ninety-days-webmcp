import { createEquitySession, executeSessionTool, getSessionCatalog } from './catalog.mjs';
import { computeExerciseModel, findAmtCrossover } from './tax/amt_6251.mjs';
import { syncSessionWebMCP } from './webmcp_adapter.mjs';

const PRIMARY_GRANT = Object.freeze({
  grantId: 'EMP-4471',
  vestedShares: 18_400,
  daysRemaining: 12,
  exercisePriceCents: 225,
  fmvCents: 1_725,
  sameYearDisposition: false,
  planClause:
    'Plan §6.3 — the post-termination period starts on the last day worked. The plan deadline controls.',
});

const SECONDARY_GRANT = Object.freeze({
  grantId: 'EMP-4482',
  vestedShares: 2_000,
  daysRemaining: 87,
  planClause: 'Plan §6.3 — the post-termination period starts on the last day worked.',
});

const TAX_PROFILE = Object.freeze({
  taxYear: 2026,
  filingStatus: 'single',
  baselineAmtiCents: 18_000_000,
  regularTaxCents: 4_000_000,
});

const MODEL_FIXTURE = Object.freeze({
  ...TAX_PROFILE,
  exercisePriceCents: PRIMARY_GRANT.exercisePriceCents,
  fmvCents: PRIMARY_GRANT.fmvCents,
  vestedShares: PRIMARY_GRANT.vestedShares,
  sameYearDisposition: PRIMARY_GRANT.sameYearDisposition,
});

const FULL_MODEL = Object.freeze(
  computeExerciseModel({ ...MODEL_FIXTURE, shares: PRIMARY_GRANT.vestedShares }),
);
const CROSSOVER = Object.freeze(findAmtCrossover(MODEL_FIXTURE));

export const PRODUCT_FIXTURE = Object.freeze({
  primaryGrant: PRIMARY_GRANT,
  grants: Object.freeze([PRIMARY_GRANT, SECONDARY_GRANT]),
  taxProfile: TAX_PROFILE,
  fullModel: FULL_MODEL,
  crossover: CROSSOVER,
});

export function formatCurrency(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatInteger(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createProductController({ documentRef = null } = {}) {
  const session = createEquitySession({
    grants: PRODUCT_FIXTURE.grants,
    taxProfile: PRODUCT_FIXTURE.taxProfile,
  });
  let lastReceipt = null;
  let runtime = { supported: false, registered: [] };

  async function syncRuntime() {
    runtime = await syncSessionWebMCP({ documentRef, session });
    return runtime;
  }

  function snapshot() {
    const state = session.snapshot();
    return {
      toolNames: getSessionCatalog(session).map(({ name }) => name),
      blackout: state.blackout,
      modeled: state.modeled,
      prepared: state.prepared,
      lastReceipt: clone(lastReceipt),
      runtime: {
        supported: Boolean(runtime.supported),
        registered: [...(runtime.registered ?? [])],
      },
    };
  }

  async function run(name, input) {
    lastReceipt = await executeSessionTool(session, name, input);
    await syncRuntime();
    return clone(lastReceipt);
  }

  return {
    snapshot,
    syncRuntime,
    model(shares) {
      return run('model_exercise', { grant_id: PRIMARY_GRANT.grantId, shares });
    },
    prepare(shares) {
      return run('prepare_exercise', { grant_id: PRIMARY_GRANT.grantId, shares });
    },
    async submit({ shares, humanConfirmed }) {
      if (!humanConfirmed) {
        lastReceipt = {
          ok: false,
          reason: 'human_confirmation_required',
          message: 'Check the human confirmation before the simulated submit.',
        };
        return clone(lastReceipt);
      }
      return run('submit_exercise', { grant_id: PRIMARY_GRANT.grantId, shares });
    },
    setBlackout(value) {
      session.setBlackout(value);
      return syncRuntime().then(snapshot);
    },
  };
}

function text(element, value) {
  if (element) element.textContent = value;
}

function initializeProduct(documentRef) {
  const controller = createProductController({ documentRef });
  const shareInput = documentRef.querySelector('[data-testid="share-input"]');
  const humanConfirm = documentRef.querySelector('[data-testid="human-confirm"]');
  const modelButton = documentRef.querySelector('[data-testid="model-action"]');
  const prepareButton = documentRef.querySelector('[data-testid="prepare-action"]');
  const submitButton = documentRef.querySelector('[data-testid="submit-action"]');
  const blackoutButton = documentRef.querySelector('[data-testid="blackout-toggle"]');

  function currentShares() {
    return Number.parseInt(shareInput?.value ?? '', 10);
  }

  function render() {
    const state = controller.snapshot();
    text(documentRef.querySelector('[data-testid="live-registry-count"]'), state.toolNames.length);
    text(
      documentRef.querySelector('[data-testid="runtime-mode"]'),
      state.runtime.supported ? 'LIVE WEBMCP' : 'MANUAL MODE · WEBMCP WAITING',
    );
    text(
      documentRef.querySelector('[data-testid="blackout-status"]'),
      state.blackout ? 'BLACKOUT ACTIVE · SUBMIT REMOVED' : 'WINDOW OPEN',
    );

    const list = documentRef.querySelector('[data-testid="registry-list"]');
    if (list) {
      list.replaceChildren(
        ...state.toolNames.map((name) => {
          const item = documentRef.createElement('li');
          item.textContent = name;
          return item;
        }),
      );
    }

    const shares = currentShares();
    const modeledExact = state.modeled?.shares === shares;
    const preparedExact = state.prepared?.shares === shares;
    modelButton.disabled = false;
    prepareButton.disabled = !modeledExact;
    submitButton.disabled = !preparedExact || !humanConfirm.checked || state.blackout;
    blackoutButton.disabled = false;
    blackoutButton.setAttribute('aria-pressed', String(state.blackout));
    text(blackoutButton, state.blackout ? 'End blackout simulation' : 'Simulate blackout');

    if (state.lastReceipt) {
      text(
        documentRef.querySelector('[data-testid="action-receipt"]'),
        JSON.stringify(state.lastReceipt, null, 2),
      );
    }
  }

  async function act(operation) {
    for (const button of [modelButton, prepareButton, submitButton, blackoutButton]) {
      button.disabled = true;
    }
    try {
      await operation();
    } catch (error) {
      text(documentRef.querySelector('[data-testid="action-receipt"]'), error.message);
    } finally {
      render();
    }
  }

  modelButton.addEventListener('click', () => act(() => controller.model(currentShares())));
  prepareButton.addEventListener('click', () => act(() => controller.prepare(currentShares())));
  submitButton.addEventListener('click', () =>
    act(() => controller.submit({ shares: currentShares(), humanConfirmed: humanConfirm.checked })),
  );
  blackoutButton.addEventListener('click', () =>
    act(() => controller.setBlackout(!controller.snapshot().blackout)),
  );
  humanConfirm.addEventListener('change', render);
  shareInput.addEventListener('input', render);

  let seconds = 12 * 24 * 60 * 60 + 4 * 60 + 17;
  const updateClock = () => {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainingSeconds = seconds % 60;
    text(documentRef.querySelector('[data-testid="countdown-days"]'), days);
    text(
      documentRef.querySelector('[data-testid="countdown-clock"]'),
      `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`,
    );
    seconds = Math.max(0, seconds - 1);
  };
  updateClock();
  globalThis.setInterval(updateClock, 1_000);

  controller.syncRuntime().finally(render);
  render();
  globalThis.NinetyDays = {
    controller,
    createEquitySession,
    getSessionCatalog,
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initializeProduct(document));
  } else {
    initializeProduct(document);
  }
}

import { executeSessionTool, getSessionCatalog } from './catalog.mjs';

let activeController = null;

function getModelContext(documentRef) {
  try {
    const modelContext = documentRef?.modelContext;
    return modelContext && typeof modelContext.registerTool === 'function' ? modelContext : null;
  } catch {
    return null;
  }
}

function sameNames(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function createDescriptor({ documentRef, session, declaration, onToolExecuted }) {
  return Object.freeze({
    ...declaration,
    async execute(input = {}, { signal } = {}) {
      const before = getSessionCatalog(session).map(({ name }) => name);
      const result = await executeSessionTool(session, declaration.name, input, { signal });
      const after = getSessionCatalog(session).map(({ name }) => name);
      const runtime = sameNames(before, after)
        ? null
        : await syncSessionWebMCP({ documentRef, session, onToolExecuted });
      await onToolExecuted?.({ name: declaration.name, input, result, runtime });
      return result;
    },
  });
}

export async function syncSessionWebMCP({
  documentRef = globalThis.document,
  session,
  onToolExecuted = null,
}) {
  const modelContext = getModelContext(documentRef);
  if (!modelContext) {
    activeController?.abort();
    activeController = null;
    return { supported: false, registered: [], controller: null };
  }

  activeController?.abort();
  const controller = new AbortController();
  const registered = [];
  try {
    for (const declaration of getSessionCatalog(session)) {
      const descriptor = createDescriptor({ documentRef, session, declaration, onToolExecuted });
      await modelContext.registerTool(descriptor, { signal: controller.signal });
      registered.push(descriptor.name);
    }
  } catch (error) {
    controller.abort();
    activeController = null;
    throw error;
  }
  activeController = controller;
  return { supported: true, registered, controller };
}

export function stopSessionWebMCP() {
  activeController?.abort();
  activeController = null;
}

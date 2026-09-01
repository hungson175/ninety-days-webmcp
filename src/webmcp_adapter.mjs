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

function createDescriptor(session, declaration) {
  return Object.freeze({
    ...declaration,
    async execute(input = {}, { signal } = {}) {
      return executeSessionTool(session, declaration.name, input, { signal });
    },
  });
}

export async function syncSessionWebMCP({ documentRef = globalThis.document, session }) {
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
      const descriptor = createDescriptor(session, declaration);
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

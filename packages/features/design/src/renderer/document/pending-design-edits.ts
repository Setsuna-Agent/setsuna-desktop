import type { DesignClient } from '../client.js';

const pendingDocumentEdits = new WeakMap<DesignClient, Map<string, Promise<boolean>>>();

export function pendingEditsFor(client: DesignClient): Map<string, Promise<boolean>> {
  let edits = pendingDocumentEdits.get(client);
  if (!edits) {
    edits = new Map();
    pendingDocumentEdits.set(client, edits);
  }
  return edits;
}

export async function withPausedDesignEdits(client: DesignClient, keys: ReadonlySet<string>, run: () => Promise<void>) {
  const pending = pendingEditsFor(client);
  const previous = [...keys].map((key) => pending.get(key) ?? true);
  const operation = Promise.all(previous).then(async (results) => {
    if (!results.every(Boolean)) return false;
    await run();
    return true;
  });
  // Publish before yielding. Existing edits finish, but no editor can append to its old queue during the move or deletion.
  const paused = operation.catch(() => false);
  for (const key of keys) pending.set(key, paused);
  try {
    await operation;
  } finally {
    for (const key of keys) if (pending.get(key) === paused) pending.delete(key);
  }
}

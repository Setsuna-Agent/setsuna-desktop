import path from 'node:path';
import type { WorkspaceTextSearchRequest } from '../../ports/workspace-search-engine.js';
import { WorkspaceSearchCancelledError } from '../../ports/workspace-search-engine.js';

export type WorkspaceSearchLease = {
  controller: AbortController;
  dispose(): void;
};

/**
 * Coordinates caller-selected latest-wins search streams without coupling
 * independent consumers that happen to search the same workspace.
 */
export class WorkspaceSearchSupersessionCoordinator {
  private readonly activeSearches = new Map<string, AbortController>();

  start(request: Pick<WorkspaceTextSearchRequest, 'root' | 'supersedeKey' | 'signal'>): WorkspaceSearchLease {
    const controller = new AbortController();
    const key = supersessionKey(request.root, request.supersedeKey);
    if (key) {
      this.activeSearches.get(key)?.abort(new WorkspaceSearchCancelledError('Workspace search was superseded.'));
      this.activeSearches.set(key, controller);
    }
    const unlinkRequestSignal = forwardAbort(request.signal, controller);
    let disposed = false;

    return {
      controller,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        unlinkRequestSignal();
        if (key && this.activeSearches.get(key) === controller) this.activeSearches.delete(key);
      },
    };
  }
}

function supersessionKey(root: string, callerKey?: string): string | null {
  if (!callerKey) return null;
  return JSON.stringify([path.resolve(root), callerKey]);
}

function forwardAbort(source: AbortSignal | undefined, destination: AbortController): () => void {
  if (!source) return () => undefined;
  const abort = () => destination.abort(source.reason ?? new WorkspaceSearchCancelledError());
  if (source.aborted) abort();
  else source.addEventListener('abort', abort, { once: true });
  return () => source.removeEventListener('abort', abort);
}

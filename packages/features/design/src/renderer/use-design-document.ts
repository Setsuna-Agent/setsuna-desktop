import { useEffect, useRef, useState } from 'react';
import { workspaceFileKey } from '@setsuna-desktop/contracts';
import { FeatureOperationFailure, isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import { useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignEdit, DesignSnapshot, NavigateDesignHistoryInput } from '../contracts/index.js';
import type { DesignDocumentSurfaceProps } from './DesignDocumentSurface.js';
import type { DesignClient } from './client.js';
import type { DesignLibraryResources } from './components/design-library-resources.js';
import { planDesignLayerUpdate } from './design-canvas-edits.js';
import type { DesignNumberEdit } from './inspector/design-inspector-edit.js';

const pendingNumberEdits = new WeakMap<DesignClient, Map<string, Promise<boolean>>>();

function numberEditsByDocument(client: DesignClient) {
  const existing = pendingNumberEdits.get(client);
  if (existing) return existing;
  const edits = new Map<string, Promise<boolean>>();
  pendingNumberEdits.set(client, edits);
  return edits;
}

export function useDesignDocument({ client, documentRef, fileRevision, watchChanges, translate }: DesignDocumentSurfaceProps) {
  const [snapshot, setSnapshot] = useState<DesignSnapshot>();
  const [busy, setBusy] = useState(false);
  const [numbersBusy, setNumbersBusy] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const snapshotRef = useRef<DesignSnapshot>();
  const write = useRef<Promise<boolean>>();
  const numberQueue = useRef<Promise<boolean>>();
  const readGeneration = useRef(0);
  const mounted = useRef(false);
  const toast = useToast();
  const documentKey = workspaceFileKey(documentRef);
  const pendingNumbers = numberEditsByDocument(client);

  function accept(next: DesignSnapshot) {
    const current = snapshotRef.current;
    if (current?.revision === next.revision && current.canUndo === next.canUndo && current.canRedo === next.canRedo) return;
    snapshotRef.current = next;
    if (mounted.current) setSnapshot(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => watchChanges?.(() => setChangeCount((count) => count + 1)), [watchChanges]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      await (numberQueue.current ?? write.current ?? pendingNumbers.get(documentKey));
      if (controller.signal.aborted || (snapshotRef.current && snapshotRef.current.revision === fileRevision)) return;
      const generation = ++readGeneration.current;
      try {
        const next = await client.read(documentRef, controller.signal);
        if (!controller.signal.aborted && generation === readGeneration.current) accept(next);
      } catch (error) {
        if (!controller.signal.aborted && generation === readGeneration.current && !isFeatureOperationCancelled(error)) {
          toast.error(translate('feature.design.loadFailed', { error: errorMessage(error) }));
        }
      }
    };
    void refresh();
    return () => controller.abort();
  }, [changeCount, client, documentKey, documentRef, fileRevision, pendingNumbers, toast, translate]);

  function mutate(operation: () => Promise<DesignSnapshot>): Promise<boolean> {
    if (write.current) return Promise.resolve(false);
    // A read started before this write must not replace the write's acknowledged snapshot.
    readGeneration.current += 1;
    if (mounted.current) setBusy(true);
    const result = Promise.resolve().then(operation).then((next) => {
      accept(next);
      return true;
    }).catch(async (error: unknown) => {
      if (isFeatureOperationCancelled(error)) return false;
      if (error instanceof FeatureOperationFailure && error.code === 'REVISION_CONFLICT') {
        toast.error(translate('feature.design.conflict'));
        // Keep the open edit draft while refreshing its underlying document.
        if (mounted.current) await client.read(documentRef).then(accept).catch(() => undefined);
      } else {
        toast.error(translate('feature.design.saveFailed', { error: errorMessage(error) }));
      }
      return false;
    }).finally(() => {
      write.current = undefined;
      if (mounted.current) setBusy(false);
    });
    write.current = result;
    return result;
  }

  function editNumber(nodeId: string, apply: DesignNumberEdit, expectedRevision: string, resources?: DesignLibraryResources): Promise<boolean> {
    const previous = numberQueue.current;
    if (!mounted.current || (!previous && (write.current || pendingNumbers.has(documentKey)
      || snapshotRef.current?.revision !== expectedRevision))) {
      return Promise.resolve(false);
    }
    setNumbersBusy(true);
    // Apply each field to the last acknowledged node so fast Tab edits cannot overwrite each other.
    const task = (previous ?? Promise.resolve(true)).then((ok) => {
      // Admission happens while mounted. Once submitted, an edit still belongs to this document after navigation.
      if (!ok) return false;
      const latest = snapshotRef.current;
      if (!latest || (!previous && latest.revision !== expectedRevision) || !Object.hasOwn(latest.document.nodes, nodeId)) return false;
      const node = latest.document.nodes[nodeId];
      const next = apply(node);
      if (next === node) return true;
      return mutate(() => client.commit({ ref: documentRef, expectedRevision: latest.revision,
        edits: planDesignLayerUpdate(latest.document, nodeId, next, undefined, resources) }));
    }).finally(() => {
      if (pendingNumbers.get(documentKey) === task) pendingNumbers.delete(documentKey);
      if (numberQueue.current !== task) return;
      numberQueue.current = undefined;
      if (mounted.current) setNumbersBusy(false);
    });
    numberQueue.current = task;
    pendingNumbers.set(documentKey, task);
    return task;
  }

  return {
    snapshot,
    busy: busy || numbersBusy,
    numbersBusy,
    editNumber,
    currentRevision: () => snapshotRef.current?.revision,
    commit: (edits: readonly DesignEdit[], expectedRevision: string) => !mounted.current || pendingNumbers.has(documentKey) ? Promise.resolve(false) : mutate(
      () => client.commit({ ref: documentRef, edits, expectedRevision }),
    ),
    navigate: (direction: NavigateDesignHistoryInput['direction'], expectedRevision: string) => !mounted.current || pendingNumbers.has(documentKey) ? Promise.resolve(false) : mutate(
      () => client.navigate({ ref: documentRef, direction, expectedRevision }),
    ),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

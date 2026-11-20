import { useEffect, useRef, useState } from 'react';
import { workspaceFileKey } from '@setsuna-desktop/contracts';
import { FeatureOperationFailure, isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { commitDesignEdits, type DesignEdit, type DesignSnapshot, type NavigateDesignHistoryInput } from '../contracts/index.js';
import { applyDesignEdits } from '../contracts/apply-design-edits.js';
import type { DesignDocumentSurfaceProps } from './DesignDocumentSurface.js';
import { planDesignLayerUpdate, type DesignEditGeometry } from './design-canvas-edits.js';
import type { DesignFieldUpdates } from './inspector/design-inspector-edit.js';
import { pendingEditsFor } from './document/pending-design-edits.js';

type LayerInsertion = Extract<DesignEdit, { kind: 'insert' }>;
export type DesignEditorSnapshot = DesignSnapshot & Readonly<{ drawingRevision: string }>;

export function useDesignDocument({ client, documentRef, fileRevision, readOnly = false, watchChanges, onDocumentMissing, translate }: DesignDocumentSurfaceProps) {
  const [snapshot, setSnapshot] = useState<DesignEditorSnapshot>();
  const [busy, setBusy] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const shown = useRef<DesignEditorSnapshot>();
  const saved = useRef<DesignSnapshot>();
  const tail = useRef<Promise<boolean>>();
  const blocking = useRef(false);
  const editSequence = useRef(0);
  const readGeneration = useRef(0);
  const mounted = useRef(false);
  const toast = useToast();
  const documentKey = workspaceFileKey(documentRef);
  const pending = pendingEditsFor(client);

  function publish(next: DesignEditorSnapshot) {
    shown.current = next;
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
      // A reopened editor waits for submitted writes from the previous mount as well.
      for (let task = pending.get(documentKey); task && !controller.signal.aborted; task = pending.get(documentKey)) await task;
      if (controller.signal.aborted || (saved.current && saved.current.revision === fileRevision)) return;
      const generation = ++readGeneration.current;
      try {
        const next = await client.read(documentRef, controller.signal);
        if (controller.signal.aborted || generation !== readGeneration.current) return;
        if (saved.current?.revision === next.revision && saved.current.canUndo === next.canUndo && saved.current.canRedo === next.canRedo) return;
        saved.current = next;
        publish({ ...next, drawingRevision: next.revision });
      } catch (error) {
        if (!controller.signal.aborted && generation === readGeneration.current && !isFeatureOperationCancelled(error)) {
          toast.error(translate('feature.design.loadFailed', { error: errorMessage(error) }));
          if (error instanceof FeatureOperationFailure && error.code === 'DESIGN_NOT_FOUND') onDocumentMissing?.();
        }
      }
    };
    void refresh();
    return () => controller.abort();
  }, [changeCount, client, documentKey, documentRef, fileRevision, onDocumentMissing, pending, toast, translate]);

  function canSubmit(expectedRevision: string) {
    const pendingWrite = pending.get(documentKey);
    return mounted.current && !readOnly && !blocking.current && (!pendingWrite || pendingWrite === tail.current)
      && shown.current?.revision === expectedRevision;
  }

  function enqueue(operation: (base: DesignSnapshot) => Promise<DesignSnapshot>, exclusive: boolean): Promise<boolean> {
    readGeneration.current += 1;
    if (exclusive) {
      blocking.current = true;
      setBusy(true);
    }
    // The renderer advances immediately, but each request uses the last revision acknowledged by the runtime.
    const task = (tail.current ?? Promise.resolve(true)).then(async (ok) => {
      if (!ok || !saved.current) return false;
      try {
        saved.current = await operation(saved.current);
        return true;
      } catch (error: unknown) {
        if (isFeatureOperationCancelled(error)) return false;
        if (error instanceof FeatureOperationFailure && error.code === 'REVISION_CONFLICT') {
          toast.error(translate('feature.design.conflict'));
          if (mounted.current) await client.read(documentRef).then((next) => { saved.current = next; }).catch(() => undefined);
        } else toast.error(translate('feature.design.saveFailed', { error: errorMessage(error) }));
        return false;
      }
    }).then((ok) => {
      if (pending.get(documentKey) === task) pending.delete(documentKey);
      if (tail.current !== task) return ok;
      tail.current = undefined;
      const acknowledged = saved.current;
      const current = shown.current;
      if (acknowledged && current) {
        if (ok && !exclusive) publish({ ...acknowledged, revision: current.revision, drawingRevision: current.drawingRevision });
        else {
          const revision = ok ? acknowledged.revision : `edit:${++editSequence.current}`;
          publish({ ...acknowledged, revision, drawingRevision: revision });
        }
      }
      if (exclusive) {
        blocking.current = false;
        if (mounted.current) setBusy(false);
      }
      return ok;
    });
    tail.current = task;
    pending.set(documentKey, task);
    return task;
  }

  function submit(edits: readonly DesignEdit[], expectedRevision: string, exclusive: boolean, drawingRevision?: string): Promise<boolean> {
    const current = shown.current;
    if (!current || !canSubmit(expectedRevision)) return Promise.resolve(false);
    if (!edits.length) return Promise.resolve(true);
    let submitted = edits;
    if (!exclusive) {
      try {
        const input = commitDesignEdits.input.parse({ ref: documentRef, expectedRevision, edits });
        submitted = input.edits;
        const document = applyDesignEdits(current.document, submitted);
        const revision = `edit:${++editSequence.current}`;
        publish({ ...current, document, revision, drawingRevision: drawingRevision ?? revision, canRedo: false });
      } catch (error: unknown) {
        toast.error(translate('feature.design.saveFailed', { error: errorMessage(error) }));
        return Promise.resolve(false);
      }
    }
    return enqueue((base) => client.commit({ ref: documentRef, expectedRevision: base.revision, edits: submitted }), exclusive);
  }

  function editFields(updates: DesignFieldUpdates, expectedRevision: string, geometry?: DesignEditGeometry): Promise<boolean> {
    const current = shown.current;
    if (!current || !canSubmit(expectedRevision)) return Promise.resolve(false);
    const edits: DesignEdit[] = [];
    for (const [id, apply] of updates) {
      const node = current.document.nodes[id];
      if (!node) return Promise.resolve(false);
      const next = apply(node);
      if (next !== node) edits.push(...planDesignLayerUpdate(current.document, id, next, geometry));
    }
    return submit(edits, expectedRevision, false);
  }

  function appendStroke(edit: LayerInsertion, drawingRevision: string): Promise<boolean> {
    const current = shown.current;
    return current?.drawingRevision === drawingRevision ? submit([edit], current.revision, false, drawingRevision) : Promise.resolve(false);
  }

  return {
    snapshot,
    busy: busy || readOnly,
    editFields,
    appendStroke,
    currentRevision: () => shown.current?.revision,
    commit: (edits: readonly DesignEdit[], expectedRevision: string) => submit(edits, expectedRevision, edits.some(changesLayerTree)),
    navigate: (direction: NavigateDesignHistoryInput['direction'], expectedRevision: string) => canSubmit(expectedRevision)
      ? enqueue((base) => client.navigate({ ref: documentRef, direction, expectedRevision: base.revision }), true) : Promise.resolve(false),
  };
}

function changesLayerTree(edit: DesignEdit) {
  return edit.kind === 'insert' || edit.kind === 'remove' || edit.kind === 'reparent' || edit.kind === 'reorder' || edit.kind === 'unlinkLibrary';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { useCallback, useLayoutEffect, useRef } from 'react';
import type { DesignCanvasSelection } from './DesignChatBridge.js';
import type { DesignDocument, DesignDocumentRef } from '../../contracts/index.js';
import type { DesignScene } from '../design-layout.js';
import { designPrototypeBoardFor } from '../prototype/design-prototype.js';

type BeginPick = Parameters<DesignCanvasSelection['subscribePicks']>[0];

export function useDesignChatPicks(document: DesignDocument, scene: DesignScene, options: {
  ref: DesignDocumentRef;
  connect?(canvas: DesignCanvasSelection): () => void;
  show(ids: readonly string[]): void;
  unavailable(): void;
}) {
  const latest = useRef({ document, options });
  useLayoutEffect(() => { latest.current = { document, options }; });
  const reveal = useCallback<DesignCanvasSelection['reveal']>(({ documentId, ids }) => {
    const current = latest.current;
    if (documentId !== current.document.documentId || ids.some((id) => !Object.hasOwn(current.document.nodes, id))) {
      current.options.unavailable();
      return;
    }
    current.options.show(ids);
  }, []);
  const listener = useRef<BeginPick>();
  const subscribePicks = useCallback((next: BeginPick) => {
    listener.current = next;
    return () => { if (listener.current === next) listener.current = undefined; };
  }, []);
  const connect = options.connect;
  useLayoutEffect(() => connect?.({ subscribePicks, reveal }), [connect, subscribePicks, reveal]);

  function beginPick(additive: boolean) {
    const begin = listener.current;
    const finish = begin?.(additive);
    if (!finish) return;
    // A gesture can outlive the draft it started in.
    return (ids: readonly string[]) => {
      if (begin !== listener.current) return;
      if (!ids.length) return finish(null);
      const boards = new Set<string>();
      for (const id of ids) {
        const root = designPrototypeBoardFor(id, scene);
        if (root && document.nodes[root]?.kind === 'frame') boards.add(root);
      }
      const first = document.nodes[ids[0]];
      const label = first.name || (first.kind === 'text' && first.text) || first.kind;
      finish({ ref: options.ref, documentId: document.documentId, boards: [...boards], ids,
        label: ids.length === 1 ? label : `${label} +${ids.length - 1}` });
    };
  }
  return { beginPick, subscribePicks, reveal };
}

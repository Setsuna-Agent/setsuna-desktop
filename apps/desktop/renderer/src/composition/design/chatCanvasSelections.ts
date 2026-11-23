import type { DesignConversationOwner } from '@setsuna-desktop/feature-design/contracts';
import type { DesignSelectionReference } from '@setsuna-desktop/feature-design/contracts/design-selection-mention';
import type { DesignCanvasSelection } from '@setsuna-desktop/feature-design/renderer';
import { designEntryKey } from '../../features/chat/artifacts/conversationArtifacts.js';

/** A workspace may show two canvases. Each gesture belongs to its source draft and the composer that received pointer-down. */
export function createChatCanvasSelections(open: (owner: DesignConversationOwner) => void) {
  const canvases = new Map<string, DesignCanvasSelection>();
  let beginPick: Parameters<DesignCanvasSelection['subscribePicks']>[0] | undefined;
  let pending: { key: string; reference: DesignSelectionReference } | undefined;
  const composer: DesignCanvasSelection = {
    subscribePicks(begin) {
      beginPick = begin;
      return () => { if (beginPick === begin) beginPick = undefined; };
    },
    reveal(reference) {
      if (!reference.ref) return;
      const owner = { ref: reference.ref, documentId: reference.documentId };
      const key = designEntryKey(owner);
      const canvas = canvases.get(key);
      pending = undefined;
      if (canvas) canvas.reveal(reference);
      else {
        pending = { key, reference };
        open(owner);
      }
    },
  };
  function connect(owner: DesignConversationOwner, canvas: DesignCanvasSelection) {
    const key = designEntryKey(owner);
    canvases.set(key, canvas);
    const unsubscribe = canvas.subscribePicks((additive) => {
      const begin = beginPick;
      const finish = begin?.(additive);
      return finish && ((reference) => {
        if (begin === beginPick) finish(reference && { ...reference, ref: owner.ref });
      });
    });
    if (pending?.key === key) {
      const { reference } = pending;
      pending = undefined;
      canvas.reveal(reference);
    }
    return () => {
      unsubscribe();
      if (canvases.get(key) === canvas) canvases.delete(key);
    };
  }
  return { composer, connect };
}

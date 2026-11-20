import { designSelectionMentionText, parseDesignSelectionMentions, type DesignSelectionReference } from '@setsuna-desktop/feature-design/contracts/design-selection-mention';
import type { DesignChatBinding } from '../../../composition/design/DesignFeatureBoundary.js';
import { Frame, Layers } from 'lucide-react';
import { createContext, Fragment, useContext, useLayoutEffect, type ReactNode } from 'react';
import type { ChatComposerReferenceSlot } from '../composer/chatComposerSlots.js';
import { applyComposerRange, composerRange } from '../composer/editor/composerDocument.js';
import type { ComposerEditor } from '../composer/editor/types.js';
import { ChatInlineReference } from '../references/ChatInlineReference.js';
import { WorkspaceMentionText } from './WorkspaceMentionText.js';

const DesignSelections = createContext<Pick<DesignChatBinding, 'documentId' | 'subscribePicks' | 'reveal'> | null>(null);
export const DesignSelectionProvider = DesignSelections.Provider;

function DesignSelectionLabel({ reference }: { reference: DesignSelectionReference }) {
  const design = useContext(DesignSelections);
  const reveal = design?.documentId === reference.documentId ? design.reveal : undefined;
  const Icon = reference.ids.length === 1 && reference.boards.includes(reference.ids[0]) ? Frame : Layers;
  return <ChatInlineReference icon={<Icon size={14} />} label={reference.label} title={reference.label}
    onActivate={reveal && (() => reveal(reference))} />;
}

export function designSelectionSlot(reference: DesignSelectionReference, value = designSelectionMentionText(reference)): ChatComposerReferenceSlot {
  return { type: 'tag', key: `design-selection:${crypto.randomUUID()}`,
    composerReference: { type: 'design-selection', value }, props: { label: <DesignSelectionLabel reference={reference} />, value } };
}

export function useDesignSelectionInsertion(getEditor: () => ComposerEditor | null, disabled: boolean) {
  const subscribe = useContext(DesignSelections)?.subscribePicks;
  useLayoutEffect(() => {
    if (!subscribe || disabled) return;
    return subscribe((additive) => {
      const editor = getEditor();
      const element = editor?.inputElement;
      if (!editor || !element) return;
      const caret = element.ownerDocument.activeElement === element ? composerRange(element) : undefined;
      return (reference) => {
        if (getEditor() !== editor) return;
        if (!reference) {
          editor.setTrailingTag(null, (tail) => tail.key.startsWith('design-selection:'));
          return;
        }
        const slot = designSelectionSlot(reference);
        if (caret && !additive) {
          editor.focus({ preventScroll: true });
          if (element.contains(caret.commonAncestorContainer)) applyComposerRange(caret);
          editor.insert([slot, { type: 'text', value: ' ' }]);
          return;
        }
        editor.setTrailingTag(slot, (tail) => tail.key.startsWith('design-selection:'));
      };
    });
  }, [disabled, getEditor, subscribe]);
}

export function DesignSelectionText({ content }: { content: string }) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const { reference, start, end } of parseDesignSelectionMentions(content)) {
    parts.push(<WorkspaceMentionText key={offset} content={content.slice(offset, start)} />);
    parts.push(<DesignSelectionLabel key={`pick:${start}`} reference={reference} />);
    offset = end;
  }
  return <Fragment>{parts}<WorkspaceMentionText content={content.slice(offset)} /></Fragment>;
}

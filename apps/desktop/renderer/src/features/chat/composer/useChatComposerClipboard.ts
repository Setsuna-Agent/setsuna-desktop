import type { SenderRef } from '@ant-design/x/es/sender';
import type { RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { useCallback, type ClipboardEvent as ReactClipboardEvent } from 'react';
import {
  CHAT_COMPOSER_CLIPBOARD_TYPE,
  createChatComposerClipboardPastePlan,
  createChatComposerClipboardSelection,
  deleteChatComposerClipboardSelection,
  setNormalizedChatComposerSelection,
} from './chatComposerClipboard.js';

type ChatComposerClipboardOptions = {
  allowStructuredPaste?: boolean;
  getEditor: () => SenderRef | null;
  onSkillsRestored: (skills: RuntimeSkillSummary[]) => void;
  skills: RuntimeSkillSummary[];
};

export function useChatComposerClipboard({
  allowStructuredPaste = true,
  getEditor,
  onSkillsRestored,
  skills,
}: ChatComposerClipboardOptions) {
  const handleClipboardWrite = useCallback((
    event: ReactClipboardEvent<HTMLDivElement>,
    operation: 'copy' | 'cut',
  ) => {
    const editor = getEditor();
    if (!editor || !(editor.inputElement instanceof HTMLDivElement)) return;
    const input = editor.inputElement;

    const clipboardSelection = createChatComposerClipboardSelection(
      input,
      editor.getValue().slotConfig,
    );
    if (!clipboardSelection) return;

    event.clipboardData.setData(CHAT_COMPOSER_CLIPBOARD_TYPE, clipboardSelection.payload);
    event.clipboardData.setData('text/plain', clipboardSelection.plainText);
    event.preventDefault();
    event.stopPropagation();

    if (operation === 'cut') {
      deleteChatComposerClipboardSelection(input, clipboardSelection);
    }
  }, [getEditor]);

  const handleCopyCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    handleClipboardWrite(event, 'copy');
  }, [handleClipboardWrite]);

  const handleCutCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    handleClipboardWrite(event, 'cut');
  }, [handleClipboardWrite]);

  const handlePasteCapture = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!allowStructuredPaste) return;
    const serializedPayload = event.clipboardData.getData(CHAT_COMPOSER_CLIPBOARD_TYPE);
    if (!serializedPayload) return;

    const editor = getEditor();
    if (!editor || !(editor.inputElement instanceof HTMLDivElement)) return;
    const input = editor.inputElement;
    if (!eventTargetsEditor(event, input)) return;
    const pastePlan = createChatComposerClipboardPastePlan(serializedPayload, skills);
    if (!pastePlan) return;

    event.preventDefault();
    event.stopPropagation();
    setNormalizedChatComposerSelection(input, editor.getValue().slotConfig);
    editor.insert(pastePlan.slots, 'cursor', undefined, true);
    onSkillsRestored(pastePlan.selectedSkills);
  }, [allowStructuredPaste, getEditor, onSkillsRestored, skills]);

  return {
    onCopyCapture: handleCopyCapture,
    onCutCapture: handleCutCapture,
    onPasteCapture: handlePasteCapture,
  };
}

function eventTargetsEditor(
  event: ReactClipboardEvent<HTMLDivElement>,
  editor: HTMLDivElement,
): boolean {
  return event.target instanceof Node
    && (event.target === editor || editor.contains(event.target));
}

import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useConfirm } from '@setsuna-desktop/renderer-ui';
import type { AutomationTask } from '../contracts/index.js';
import type { AutomationClient } from './client.js';

type EditorTarget = { threadId: string; task?: AutomationTask };

/** Capture the action's task explicitly; a context menu need not change selection. */
export function useAutomationTaskActions(client: AutomationClient, perform: (action: () => Promise<unknown>) => Promise<void>, t: RendererTranslate) {
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const confirm = useConfirm();
  return {
    editor,
    create: (threadId?: string) => {
      if (threadId) { setEditor({ threadId }); return; }
      // New tasks opened from an existing task/run need their own setup conversation.
      return perform(async () => {
        const draft = await client.createConversation();
        setEditor({ threadId: draft.threadId });
      });
    },
    edit: (task: AutomationTask) => setEditor({ threadId: task.conversationThreadId, task }),
    closeEditor: () => setEditor(null),
    toggleStatus: (task: AutomationTask) => perform(() => client.setStatus(task.id, task.status === 'active' ? 'paused' : 'active')),
    run: (task: AutomationTask) => perform(() => client.run(task.id)),
    async remove(task: AutomationTask) {
      if (await confirm({ title: t('feature.automation.deleteTitle'), confirmLabel: t('feature.automation.delete'), danger: true })) {
        await perform(() => client.delete(task.id));
      }
    },
  };
}

export type AutomationTaskActions = ReturnType<typeof useAutomationTaskActions>;

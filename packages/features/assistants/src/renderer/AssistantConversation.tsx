import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { ChatThinkingSelection, ChatTurnNavigationRequest } from '@setsuna-desktop/renderer-contracts/chat';
import { Button, ToastNotice } from '@setsuna-desktop/renderer-ui';
import type { AssistantsRendererService } from './client.js';
import type { AssistantsHostUi, AssistantsToolbarProps } from './host.js';
import { AssistantInfoPanel } from './AssistantInfoPanel.js';
import { AssistantPeerRequests } from './AssistantPeerRequests.js';
import { errorMessage } from './errors.js';
import { useAssistantsPolling } from './useAssistantsPolling.js';

export type AssistantConversationProps = {
  service: AssistantsRendererService;
  ui: AssistantsHostUi;
  threadId?: string;
  scheduledThreadIds?: ReadonlySet<string>;
  openConversation(threadId: string): Promise<boolean>;
  renderToolbar(props: AssistantsToolbarProps): ReactNode;
  renderConversation(starter: ReactNode, thinking: ChatThinkingSelection, info: ReactNode, navigation?: ChatTurnNavigationRequest, composerHeader?: ReactNode): ReactNode;
  translate: RendererTranslate;
};

export function AssistantConversation({ service, ui, threadId, scheduledThreadIds, openConversation, renderToolbar, renderConversation, translate: t }: AssistantConversationProps) {
  const { snapshot, loadError, retry } = useAssistantsPolling(service);
  const [actionError, setActionError] = useState<string | null>(null);
  const [navigation, setNavigation] = useState<ChatTurnNavigationRequest>();
  const navigationSequence = useRef(0);
  const redirected = useRef<string>();
  const conversation = snapshot?.conversations.find((item) => item.threadId === threadId || (threadId && item.previousThreadIds?.includes(threadId)));
  const assistant = snapshot?.assistants.find((item) => item.id === conversation?.assistantId);
  useEffect(() => {
    if (!threadId || !conversation || conversation.threadId === threadId || redirected.current === threadId) return;
    redirected.current = threadId;
    void openConversation(conversation.threadId).catch((cause: unknown) => setActionError(errorMessage(cause)));
  }, [conversation, openConversation, threadId]);

  if (!snapshot || !assistant) return <main className="assistant-conversation-unavailable">
    {loadError ? <Button variant="ghost" onClick={retry}>{t('feature.assistants.retry')}</Button> : t(snapshot ? 'feature.assistants.unavailable' : 'feature.assistants.loading')}
    <ToastNotice message={loadError} />
  </main>;
  return <>
    {renderToolbar({ title: assistant.name, actions: [] })}
    {renderConversation(<div className="assistants-starter"><ui.Avatar assistant={assistant} size="list" /><h1>{assistant.name}</h1></div>, {
      enabled: Boolean(assistant.thinkingEffort), effort: assistant.thinkingEffort ?? '',
    }, <AssistantInfoPanel key={assistant.id} assistant={assistant} snapshot={snapshot} service={service} ui={ui} scheduledThreadIds={scheduledThreadIds} translate={t}
      onOpenTask={(task) => { void openConversation(task.workThreadId).catch((cause: unknown) => setActionError(errorMessage(cause))); }}
      onOpenReminder={(reminder) => {
        const run = reminder.lastRun;
        if (run?.turnId && run.threadId === threadId) {
          setNavigation({ requestId: ++navigationSequence.current, threadId, turnId: run.turnId });
        } else if (conversation) {
          void openConversation(conversation.threadId).catch((cause: unknown) => setActionError(errorMessage(cause)));
        }
      }} />, navigation?.threadId === threadId ? navigation : undefined,
    <AssistantPeerRequests key={assistant.id} assistantId={assistant.id} snapshot={snapshot} service={service} translate={t} />)}
    <ToastNotice message={actionError} />
  </>;
}

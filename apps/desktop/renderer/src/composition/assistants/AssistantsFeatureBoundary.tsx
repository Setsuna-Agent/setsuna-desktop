import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { AssistantConversation, useAssistantsSnapshot, type AssistantsRendererService } from '@setsuna-desktop/feature-assistants/renderer';
import { ChatRouteAdapter } from '../../app/layout/ChatRouteAdapter.js';
import type { AppRouteContentProps } from '../../app/layout/AppRouteContent.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { FeatureRouteTopbar } from '../feature-ui/FeatureRouteTopbar.js';
import { assistantsHostUi } from './AssistantsHostUi.js';

const AssistantsContext = createContext<AssistantsRendererService | null>(null);

export function useAssistantsFeature(): AssistantsRendererService | null {
  return useContext(AssistantsContext);
}

export function AssistantsFeatureServiceBoundary({ service, children }: { service: AssistantsRendererService | null; children: ReactNode }) {
  return <AssistantsContext.Provider value={service}>{children}</AssistantsContext.Provider>;
}

export function AssistantWorkConversationAdapter(props: AppRouteContentProps) {
  const service = useAssistantsFeature();
  return service ? <AssistantWorkConversation {...props} service={service} /> : <ChatRouteAdapter {...props} />;
}

function AssistantWorkConversation({ service, ...props }: AppRouteContentProps & { service: AssistantsRendererService }) {
  const snapshot = useAssistantsSnapshot(service.store);
  const thread = props.runtime.currentThread;
  const task = snapshot?.tasks.find((item) => item.workThreadId === thread?.id);
  useEffect(() => {
    if (task) return;
    const abort = new AbortController();
    void service.store.refresh(abort.signal).catch(() => undefined);
    return () => abort.abort();
  }, [service, task, thread?.id]);
  const execution = task?.execution;
  const binding = thread?.modelBinding;
  // A later user model choice is independent of the configuration used by the assistant's task.
  const sameModel = !execution?.modelSelection || !binding
    || (execution.modelSelection.providerId === binding.providerId && execution.modelSelection.modelId === binding.modelId);
  const thinking = execution && sameModel ? { enabled: Boolean(execution.thinkingEffort), effort: execution.thinkingEffort ?? '' } : undefined;
  return <ChatRouteAdapter {...props} defaultThinking={thinking} />;
}

/** Assistant threads live in the home chat route, with the same persistent sidebar. */
export function AssistantConversationAdapter(props: AppRouteContentProps) {
  const service = useAssistantsFeature();
  const { t } = useI18n();
  const { onSelectConversation } = props;
  const thread = props.runtime.currentThread;
  // Use the persisted execution origin, never task titles, to identify scheduled work.
  const scheduledThreadIds = useMemo(() => new Set([...props.runtime.threads, ...props.runtime.archivedThreads]
    .filter((item) => item.origin?.featureId === 'automation').map((item) => item.id)), [props.runtime.archivedThreads, props.runtime.threads]);
  const openConversation = useCallback(
    (threadId: string) => onSelectConversation?.(threadId, 'chat') ?? Promise.resolve(false),
    [onSelectConversation],
  );
  if (!service) return <main className="assistant-conversation-unavailable" role="alert">{t('feature.assistants.unavailable')}</main>;
  const starterVisible = !thread?.messages.length && !thread?.activeTurnId;
  return <AssistantConversation service={service} ui={assistantsHostUi} threadId={thread?.id} scheduledThreadIds={scheduledThreadIds}
    openConversation={openConversation} renderToolbar={(toolbar) => <FeatureRouteTopbar {...toolbar} />}
    renderConversation={(starter, defaultThinking, info, navigation, composerHeader) => <ChatRouteAdapter {...props}
      presentation="messenger" defaultThinking={defaultThinking} conversationInfo={info} turnNavigationRequest={navigation} composerHeader={composerHeader}
      starterPresentation={{ content: starter, visible: starterVisible }} />}
    translate={t} />;
}

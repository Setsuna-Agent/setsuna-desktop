import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';
import { designFileKey, type DesignDocumentRef } from '@setsuna-desktop/feature-design/contracts';
import { resolveDesignInputSelection } from '@setsuna-desktop/feature-design/contracts/design-selection-mention';
import { DesignSelectionProvider } from '../../features/chat/mentions/DesignSelectionReference.js';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { ChatWorkspace } from '../../features/chat/ChatWorkspace.js';
import { chatComposerTargetIdentity, useChatComposerSession } from '../../features/chat/hooks/useChatComposerSession.js';
import { useChatTurnActions } from '../../features/chat/hooks/useChatTurnActions.js';
import { useObservedRuntimeThread } from '../../features/chat/hooks/useObservedRuntimeThread.js';
import { searchWorkspaceMentions } from '../../features/chat/mentions/searchWorkspaceMentions.js';
import { usePluginManagementFeatureSnapshot } from '../PluginManagementFeatureBoundary.js';
import { useSkillsFeatureSnapshot } from '../SkillsFeatureBoundary.js';
import { useReviewFeatureService } from '../ReviewFeatureBoundary.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { DesignChatProps } from './DesignChatSidebar.js';
import { DesignChatStarter } from './DesignChatStarter.js';

type Props = DesignChatProps & {
  readOnly: boolean; threadId: string | null; create(): Promise<string>; onCreated(id: string): void;
  reload(): Promise<void>; onBusy(busy: boolean): void;
};

export function DesignConversationPanel({ binding, conversations, project, runtime, readOnly, threadId, create, onCreated, reload, onBusy }: Props) {
  const { client, config } = runtime;
  const { locale, t } = useI18n();
  const toast = useToast();
  const { onBusyChange } = binding;
  const report = useCallback((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)), [toast]);
  const setError = useCallback((action: SetStateAction<string | null>) => {
    const message = typeof action === 'function' ? action(null) : action;
    if (message) report(message);
  }, [report]);
  const observed = useObservedRuntimeThread({ client, threadId, onError: report });
  const { currentThread, activeTurnId } = observed;
  const identity = chatComposerTargetIdentity(threadId, JSON.stringify([binding.ref, binding.documentId]));
  const composer = useChatComposerSession(identity, client);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const consumeComposerFocus = useCallback((request: number) => {
    setComposerFocusRequest((current) => current === request ? 0 : current);
  }, []);
  const skills = useSkillsFeatureSnapshot();
  const plugins = usePluginManagementFeatureSnapshot();
  const review = useReviewFeatureService();
  const [submitting, setSubmitting] = useState(false);
  const owned = useRef(false);
  const lastStatus = currentThread?.turns?.at(-1)?.status;
  const nextInput = currentThread?.queuedTurnInputs?.[0];
  const pendingTarget = nextInput && resolveDesignInputSelection(nextInput.input, nextInput.editorSelection);
  // Keep the editor across a successful handoff. Interrupted turns leave their queue for a manual retry.
  const busy = submitting || Boolean(activeTurnId) || Boolean(owned.current && nextInput
    && lastStatus !== 'failed' && lastStatus !== 'cancelled'
    && pendingTarget?.status === 'resolved' && pendingTarget.selection.documentId === binding.documentId
    && (nextInput.editorSelection?.ownerThreadId === threadId || pendingTarget.refs.every((ref) => designFileKey(ref) === designFileKey(binding.ref))));
  useLayoutEffect(() => {
    if (!busy || !onBusyChange) return;
    // Keep the editor through the first send, before an active runtime turn exists.
    onBusyChange(true);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    onBusy(busy);
    if (!busy && owned.current) {
      owned.current = false;
      void binding.release().then(reload).catch(report);
    }
  }, [busy, binding.release, onBusy, reload, report]);
  const createThread = async () => client.getThread(await create());
  const selectSnapshot: typeof observed.setCurrentThread = (next) => {
    observed.setCurrentThread(next);
    if (!threadId && next && typeof next !== 'function') onCreated(next.id);
  };
  async function matchesFile(ref: DesignDocumentRef, id: string) {
    if (designFileKey(ref) === designFileKey(binding.ref)) return true;
    // Overlapping roots can address one physical draft. Its owned chat follows the file.
    return (await conversations.list({ ref, documentId: binding.documentId })).some((chat) => !chat.legacy && chat.id === id);
  }
  const actions = useChatTurnActions({
    activeProjectId: project?.id ?? null, activeTurnId, client, config, currentThread, draft: composer.draft, composerKey: composer.composerKey,
    createThread, claimComposerForThread: composer.claimForThread, reloadThreads: reload, setError,
    setCurrentThread: selectSnapshot, setActiveTurnId: observed.setActiveTurnId,
    terminalTurnIdsRef: observed.terminalTurnIdsRef, setDraft: composer.setDraft,
    prepareTurn: async (id, content, clientId, queued) => {
      const target = resolveDesignInputSelection(content, queued?.editorSelection);
      if (target.status === 'conflict' || (target.status === 'resolved' && (target.selection.documentId !== binding.documentId
        || (queued?.editorSelection?.ownerThreadId !== id && !(await Promise.all(target.refs.map((ref) => matchesFile(ref, id)))).every(Boolean))))) {
        throw new Error(t('feature.design.selectionUnavailable'));
      }
      if (queued && target.status === 'missing') throw new Error(t('feature.design.queuedSelectionMissing'));
      await binding.bind(id, target.selection?.ids, clientId ?? queued?.id);
      owned.current = true;
    },
  });
  async function submit<T>(operation: () => Promise<T>) {
    setSubmitting(true);
    try { return await operation(); }
    finally { setSubmitting(false); }
  }
  const context = (action: 'clearThreadContext' | 'compactThreadContext') => {
    if (threadId) void client[action](threadId).then((snapshot) => observed.adoptSnapshot(threadId, snapshot)).catch(report);
  };
  function choosePrompt(prompt: string) {
    // Appending keeps the draft's existing mention offsets and attachments.
    composer.setDraft((draft) => draft.trim() ? `${draft}\n\n${prompt}` : prompt);
    setComposerFocusRequest((request) => request + 1);
  }
  // A history switch must load its snapshot before enabling a send against that identity.
  if ((currentThread?.id ?? null) !== threadId) return null;
  const reveal = (reference: Parameters<NonNullable<typeof binding.reveal>>[0]) => {
    if (!reference.ref || designFileKey(reference.ref) === designFileKey(binding.ref)) return binding.reveal?.(reference);
    if (threadId) void matchesFile(reference.ref, threadId).then((matches) => {
      if (matches) binding.reveal?.(reference);
      else toast.error(t('feature.design.selectionUnavailable'));
    }).catch(report);
  };
  return <DesignSelectionProvider value={{ ...binding, reveal: binding.reveal && reveal }}><ChatWorkspace readOnly={readOnly} variant="side" client={client} config={config} activeProject={project} activeTurnId={activeTurnId}
    currentThread={currentThread} composerKey={composer.composerKey} attachmentStore={composer.attachmentStore}
    draft={composer.draft} draftSkillReferences={composer.draftSkillReferences} draftWorkspaceReferences={composer.draftWorkspaceReferences}
    draftSendIntent={composer.draftSendIntent} retrievingQueuedInput={composer.retrievingQueuedInput} onDraftChange={composer.setDraft}
    focusComposerRequest={composerFocusRequest} onFocusComposerRequestConsumed={consumeComposerFocus}
    starterPresentation={threadId === null ? { content: <DesignChatStarter onChoose={choosePrompt} />, visible: !busy } : undefined}
    skills={[...skills.skills]} plugins={[...plugins.plugins]} capabilitySelectionRequest={null}
    onCapabilitySelectionRequestConsumed={() => undefined} onAccessModeChange={(selection) => { void runtime.saveRuntimePreferences(selection); }}
    onSelectModel={runtime.selectConversationModel} onSearchProjectEntries={(query, parent) => searchWorkspaceMentions(client, project, query, parent)}
    onAnswerApproval={observed.answerApproval} queuedTurnActions={{ ...actions, sendQueuedTurnInputNow: (id) => submit(() => actions.sendQueuedTurnInputNow(id)) }} onDeleteMessages={actions.deleteMessages}
    onSend={(value, options) => submit(() => actions.sendInput(value, options))}
    onEditUserMessage={(id, patch) => submit(() => actions.editUserMessage(id, patch))}
    onCancelActiveTurn={() => { void (owned.current ? binding.release() : actions.cancelActiveTurn()).catch(report); }}
    canClearContext={Boolean(currentThread?.messages.length)} onClearContext={() => context('clearThreadContext')}
    onCompactContext={() => context('compactThreadContext')} onStartThreadReview={(target, modelSelection) => submit(async () => {
      try {
        const thread = currentThread ?? await createThread();
        if (!currentThread) { composer.claimForThread(thread.id); selectSnapshot(thread); }
        const started = await review.start({ threadId: thread.id, language: locale, target, modelSelection });
        observed.setActiveTurnId(started.turnId);
        return started;
      } catch (error) { report(error); throw error; }
    })} /></DesignSelectionProvider>;
}

import type { ForkThreadInput } from '@setsuna-desktop/contracts';
import { Button, Dropdown, Tooltip } from '@setsuna-desktop/renderer-ui';
import { LoaderCircle, Split } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useChatThreadId } from '../conversation/ChatThreadProvider.js';

type ChatForkState = {
  threadId: string | null;
  canCreateWorktree: boolean;
  disabled: boolean;
  pendingMessageId: string | null;
  fork(input: ForkThreadInput): Promise<void>;
};

const ChatForkContext = createContext<ChatForkState | null>(null);

export function ChatForkProvider({
  children, threadId, canCreateWorktree, disabled, onFork, onError,
}: {
  children: ReactNode;
  threadId: string | null;
  canCreateWorktree: boolean;
  disabled: boolean;
  onFork(input: ForkThreadInput): Promise<void>;
  onError(message: string): void;
}) {
  const [pendingMessages, setPendingMessages] = useState<Record<string, string>>({});
  const pendingThreads = useRef(new Set<string>());
  const pendingMessageId = threadId ? pendingMessages[threadId] ?? null : null;
  const requests = useIdentityRequestGuard(threadId ?? 'empty');
  const fork = useCallback(async (input: ForkThreadInput) => {
    if (!threadId || disabled || pendingThreads.current.has(threadId)) return;
    const isCurrent = requests.begin();
    pendingThreads.current.add(threadId);
    setPendingMessages((current) => ({ ...current, [threadId]: input.messageId }));
    try {
      await onFork(input);
    } catch (error) {
      if (isCurrent()) onError(error instanceof Error ? error.message : String(error));
    } finally {
      pendingThreads.current.delete(threadId);
      setPendingMessages((current) => {
        const next = { ...current };
        delete next[threadId];
        return next;
      });
    }
  }, [disabled, onError, onFork, requests, threadId]);
  const value = useMemo(() => ({
    threadId, canCreateWorktree, disabled: disabled || pendingMessageId !== null, pendingMessageId, fork,
  }), [canCreateWorktree, disabled, fork, pendingMessageId, threadId]);
  return <ChatForkContext.Provider value={value}>{children}</ChatForkContext.Provider>;
}

export function ChatForkAction({ messageId, disabled }: { messageId: string; disabled: boolean }) {
  const state = useContext(ChatForkContext);
  const threadId = useChatThreadId();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Side conversations and read-only transcripts do not inherit the main thread's action.
  if (!state || !threadId || threadId !== state.threadId) return null;
  const pending = state.pendingMessageId === messageId;
  const label = t(pending ? 'chat.fork.pending' : 'chat.fork.title');
  const selectTarget = (target: ForkThreadInput['target']) => {
    setOpen(false);
    void state.fork({ messageId, target });
  };
  return (
    <Dropdown
      disabled={disabled || state.disabled}
      open={open && !disabled && !state.disabled}
      onOpenChange={setOpen}
      placement="topLeft"
      menu={{ items: [{
        type: 'group', label: t('chat.fork.title'), children: [
          { key: 'workspace', label: t('chat.fork.workspace'), icon: <Split size={15} />,
            onClick: () => selectTarget('workspace') },
          { key: 'worktree', label: t('chat.fork.worktree'), icon: <Split size={15} />,
            disabled: !state.canCreateWorktree,
            tooltip: state.canCreateWorktree ? undefined : t('chat.fork.requiresGit'),
            onClick: () => selectTarget('worktree') },
        ],
      }] }}
    >
      <Tooltip title={label} disabled={open} placement="top">
        <Button variant="ghost" type="button" aria-label={label} disabled={disabled || state.disabled}>
          {pending ? <LoaderCircle size={14} aria-hidden="true" /> : <Split size={14} strokeWidth={1.8} aria-hidden="true" />}
        </Button>
      </Tooltip>
    </Dropdown>
  );
}

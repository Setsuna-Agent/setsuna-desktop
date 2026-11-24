import type { RuntimeThread, RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { ArchiveRow, ArchiveSection, ToastNotice, ConfirmDialogTrigger } from '@setsuna-desktop/renderer-ui';
import { MessageSquare, PenTool, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createDesktopRuntimeClient } from '../../../services/runtime-client/client.js';
import { notifyDesignConversationArchiveChanged, observeDesignConversationArchives } from '../../../services/runtime-client/designConversationArchives.js';
import { useLatestRequestGuard } from '../../../shared/hooks/useLatestRequestGuard.js';
import { Button, IconButton } from '../../../shared/ui/primitives.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { errorMessage, formatSettingsDate } from '../settings-utils.js';

export function ArchivedThreadsSettings({
  threads: primaryThreads,
  onDelete,
  onDeleteAll,
  onRestore,
}: {
  threads: RuntimeThreadSummary[];
  onDelete: (threadId: string) => Promise<void>;
  onDeleteAll: (threadIds: string[]) => Promise<void>;
  onRestore: (threadId: string) => Promise<RuntimeThread>;
}) {
  const { locale, t } = useI18n();
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [bulkDeletion, setBulkDeletion] = useState<{ threadIds: string[]; includesDesign: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [designThreads, setDesignThreads] = useState<RuntimeThreadSummary[] | null>(null);
  const [refreshingDesignArchives, setRefreshingDesignArchives] = useState(false);
  const requests = useLatestRequestGuard();
  const loadDesignArchives = useCallback(async () => {
    const isCurrent = requests.begin();
    setRefreshingDesignArchives(true);
    try {
      const result = await createDesktopRuntimeClient().listThreads({ includeFeatures: true, includeArchived: true });
      if (isCurrent()) setDesignThreads(result.threads.filter((thread) =>
        thread.featureId === 'design' && thread.archived && !thread.parentThreadId && thread.kind !== 'side'));
    } catch (cause) {
      if (isCurrent()) {
        setDesignThreads(null);
        setError(errorMessage(cause, t('settings.archives.operationError')));
      }
    } finally {
      if (isCurrent()) setRefreshingDesignArchives(false);
    }
  }, [requests, t]);
  useEffect(() => {
    void loadDesignArchives();
    return observeDesignConversationArchives(loadDesignArchives);
  }, [loadDesignArchives]);
  const threads = [...primaryThreads, ...(designThreads ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const runAction = async (threadId: string, action: () => Promise<unknown>) => {
    setBusyThreadId(threadId);
    setError(null);
    try {
      await action();
    } catch (unknownError) {
      setError(errorMessage(unknownError, t('settings.archives.operationError')));
    } finally {
      if (designThreads?.some(({ id }) => id === threadId)) notifyDesignConversationArchiveChanged();
      setBusyThreadId(null);
    }
  };

  const deleteAll = async () => {
    if (!bulkDeletion) return;
    setDeletingAll(true);
    setError(null);
    try {
      await onDeleteAll(bulkDeletion.threadIds);
    } catch (unknownError) {
      setError(errorMessage(unknownError, t('settings.archives.deleteAllError')));
    } finally {
      if (bulkDeletion.includesDesign) notifyDesignConversationArchiveChanged();
      setBulkDeletion(null);
      setDeletingAll(false);
    }
  };

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked">
      <ArchiveSection title={t('settings.archives.title')} emptyLabel={designThreads && !threads.length ? t('settings.archives.empty') : undefined}
        actions={threads.length ? (
          <ConfirmDialogTrigger
            title={t('settings.archives.deleteAllTitle', { count: bulkDeletion?.threadIds.length ?? threads.length })}
            description={t('settings.archives.irreversible')}
            confirmLabel={t('settings.archives.deleteAll')}
            cancelLabel={t('common.cancel')}
            danger
            onConfirm={deleteAll}
          >
            <Button className="sd-archive__delete" icon={<Trash2 size={14} />} variant="ghost"
              disabled={designThreads === null || refreshingDesignArchives || deletingAll || busyThreadId !== null}
              onClick={() => setBulkDeletion({ threadIds: threads.map(({ id }) => id), includesDesign: Boolean(designThreads?.length) })}>
              {t('settings.archives.deleteAll')}
            </Button>
          </ConfirmDialogTrigger>
        ) : null}>
        {threads.map((thread) => {
          const busy = deletingAll || busyThreadId !== null || (thread.featureId === 'design' && refreshingDesignArchives);
          const title = thread.title || t('settings.archives.untitled');
          // Owned chats need a draft, and legacy chats need a project to appear in history.
          const canRestore = thread.featureId !== 'design' || Boolean(thread.origin ? thread.origin.entityId : thread.projectId);
          return (
            <ArchiveRow key={thread.id} title={title} icon={thread.featureId === 'design' ? <PenTool size={18} /> : <MessageSquare size={18} />}
              metadata={t('settings.archives.messagesUpdated', { count: thread.messageCount, date: formatSettingsDate(thread.updatedAt, locale) })}
              actions={<>
                {canRestore && <Button variant="ghost" icon={<Undo2 size={14} />} disabled={busy}
                  onClick={() => void runAction(thread.id, () => onRestore(thread.id))}>{t('settings.archives.restore')}</Button>}
                <ConfirmDialogTrigger title={t('settings.archives.deleteTitle', { title })} description={t('settings.archives.irreversible')}
                  confirmLabel={t('settings.archives.deletePermanently')} cancelLabel={t('common.cancel')} danger
                  onConfirm={() => runAction(thread.id, () => onDelete(thread.id))}>
                  <IconButton className="sd-archive__delete" label={t('settings.archives.deleteLabel', { title })}
                    disabled={busy}><Trash2 size={14} /></IconButton>
                </ConfirmDialogTrigger>
              </>} />
          );
        })}
      </ArchiveSection>
      {error ? <ToastNotice message={error} /> : null}
    </div>
  );
}

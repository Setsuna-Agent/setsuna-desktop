import type { RuntimeThread, RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { ArchiveRow, ArchiveSection, ToastNotice, ConfirmDialogTrigger } from '@setsuna-desktop/renderer-ui';
import { MessageSquare, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton } from '../../../shared/ui/primitives.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { errorMessage, formatSettingsDate } from '../settings-utils.js';

export function ArchivedThreadsSettings({
  threads,
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
  const [error, setError] = useState<string | null>(null);

  const runAction = async (threadId: string, action: () => Promise<unknown>) => {
    setBusyThreadId(threadId);
    setError(null);
    try {
      await action();
    } catch (unknownError) {
      setError(errorMessage(unknownError, t('settings.archives.operationError')));
    } finally {
      setBusyThreadId(null);
    }
  };

  const deleteAll = async () => {
    setDeletingAll(true);
    setError(null);
    try {
      await onDeleteAll(threads.map((thread) => thread.id));
    } catch (unknownError) {
      setError(errorMessage(unknownError, t('settings.archives.deleteAllError')));
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked">
      <ArchiveSection title={t('settings.archives.title')} emptyLabel={threads.length ? undefined : t('settings.archives.empty')}
        actions={threads.length ? (
          <ConfirmDialogTrigger
            title={t('settings.archives.deleteAllTitle', { count: threads.length })}
            description={t('settings.archives.irreversible')}
            confirmLabel={t('settings.archives.deleteAll')}
            cancelLabel={t('common.cancel')}
            danger
            onConfirm={deleteAll}
          >
            <Button className="sd-archive__delete" icon={<Trash2 size={14} />} variant="ghost"
              disabled={deletingAll || busyThreadId !== null}>{t('settings.archives.deleteAll')}</Button>
          </ConfirmDialogTrigger>
        ) : null}>
        {threads.map((thread) => {
          const busy = deletingAll || busyThreadId === thread.id;
          const title = thread.title || t('settings.archives.untitled');
          return (
            <ArchiveRow key={thread.id} title={title} icon={<MessageSquare size={18} />}
              metadata={t('settings.archives.messagesUpdated', { count: thread.messageCount, date: formatSettingsDate(thread.updatedAt, locale) })}
              actions={<>
                <Button variant="ghost" icon={<Undo2 size={14} />} disabled={busy}
                  onClick={() => void runAction(thread.id, () => onRestore(thread.id))}>{t('settings.archives.restore')}</Button>
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

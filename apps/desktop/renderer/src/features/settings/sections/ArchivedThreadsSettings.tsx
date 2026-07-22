import type { RuntimeThread, RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { Popconfirm } from 'antd';
import { Archive, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Button, EmptyState, IconButton } from '../../../shared/ui/primitives.js';
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
    <div className="chat-user-settings__section chat-user-settings__section--stacked settings-archives-section">
      <div className="chat-user-settings__section-block">
        <div className="settings-archives-header">
          <div className="chat-user-settings__group-title">{t('settings.archives.title')}</div>
          {threads.length ? (
            <Popconfirm
              title={t('settings.archives.deleteAllTitle', { count: threads.length })}
              description={t('settings.archives.irreversible')}
              placement="bottomRight"
              okText={t('settings.archives.deleteAll')}
              cancelText={t('common.cancel')}
              okButtonProps={{ danger: true }}
              onConfirm={deleteAll}
            >
              <Button icon={<Trash2 size={14} />} variant="danger" disabled={deletingAll || busyThreadId !== null}>{t('settings.archives.deleteAll')}</Button>
            </Popconfirm>
          ) : null}
        </div>
        <div className="settings-archives-list">
          {threads.length ? threads.map((thread) => {
            const busy = deletingAll || busyThreadId === thread.id;
            return (
              <div className="settings-archives-row" key={thread.id}>
                <span className="settings-archives-row__icon"><Archive size={15} /></span>
                <span className="settings-archives-row__copy">
                  <strong title={thread.title}>{thread.title || t('settings.archives.untitled')}</strong>
                  <small>{t('settings.archives.messagesUpdated', { count: thread.messageCount, date: formatSettingsDate(thread.updatedAt, locale) })}</small>
                </span>
                <Button icon={<Undo2 size={14} />} disabled={busy} onClick={() => void runAction(thread.id, () => onRestore(thread.id))}>{t('settings.archives.restore')}</Button>
                <Popconfirm title={t('settings.archives.deleteTitle', { title: thread.title || t('settings.archives.untitled') })} description={t('settings.archives.irreversible')} placement="topRight" okText={t('settings.archives.deletePermanently')} cancelText={t('common.cancel')} okButtonProps={{ danger: true }} onConfirm={() => runAction(thread.id, () => onDelete(thread.id))}>
                  <IconButton label={t('settings.archives.deleteLabel', { title: thread.title || t('settings.archives.untitled') })} variant="danger" disabled={busy}><Trash2 size={14} /></IconButton>
                </Popconfirm>
              </div>
            );
          }) : <EmptyState title={t('settings.archives.empty')} />}
        </div>
        {error ? <div className="settings-archives-error" role="alert">{error}</div> : null}
      </div>
    </div>
  );
}

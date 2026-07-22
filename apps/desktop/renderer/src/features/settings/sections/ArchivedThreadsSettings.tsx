import type { RuntimeThread, RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { Popconfirm } from 'antd';
import { Archive, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Button, EmptyState, IconButton } from '../../../shared/ui/primitives.js';
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
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (threadId: string, action: () => Promise<unknown>) => {
    setBusyThreadId(threadId);
    setError(null);
    try {
      await action();
    } catch (unknownError) {
      setError(errorMessage(unknownError, '归档操作失败。'));
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
      setError(errorMessage(unknownError, '归档对话全部删除失败。'));
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked settings-archives-section">
      <div className="chat-user-settings__section-block">
        <div className="settings-archives-header">
          <div className="chat-user-settings__group-title">已归档的对话</div>
          {threads.length ? (
            <Popconfirm
              title={`永久删除全部 ${threads.length} 个归档对话？`}
              description="此操作不可撤销。"
              placement="bottomRight"
              okText="全部删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={deleteAll}
            >
              <Button icon={<Trash2 size={14} />} variant="danger" disabled={deletingAll || busyThreadId !== null}>全部删除</Button>
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
                  <strong title={thread.title}>{thread.title || '未命名对话'}</strong>
                  <small>{thread.messageCount} 条消息 · 更新于 {formatSettingsDate(thread.updatedAt)}</small>
                </span>
                <Button icon={<Undo2 size={14} />} disabled={busy} onClick={() => void runAction(thread.id, () => onRestore(thread.id))}>恢复</Button>
                <Popconfirm title={`永久删除“${thread.title || '未命名对话'}”？`} description="此操作不可撤销。" placement="topRight" okText="永久删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => runAction(thread.id, () => onDelete(thread.id))}>
                  <IconButton label={`永久删除 ${thread.title || '未命名对话'}`} variant="danger" disabled={busy}><Trash2 size={14} /></IconButton>
                </Popconfirm>
              </div>
            );
          }) : <EmptyState title="暂无归档对话" />}
        </div>
        {error ? <div className="settings-archives-error" role="alert">{error}</div> : null}
      </div>
    </div>
  );
}

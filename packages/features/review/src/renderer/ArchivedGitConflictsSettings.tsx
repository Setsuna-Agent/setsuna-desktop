import { Popconfirm } from 'antd';
import { Archive, Eye, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { WorkspaceGitConflictTask } from '../contracts/index.js';
import type { ReviewClient } from './client.js';
import { useReviewRendererHost } from './host.js';
import { useArchivedGitConflicts } from './history/useArchivedGitConflicts.js';

/** Review contributes its own durable records to the shared archive settings page. */
export function ArchivedGitConflictsSettings({ client, translate: t, ui }: {
  client: Pick<ReviewClient, 'readArchivedGitConflicts' | 'setGitConflictArchived' | 'deleteGitConflictTask'>;
  translate: RendererTranslate;
  ui: Pick<SettingsViewUi, 'Section' | 'Group' | 'Row' | 'Button' | 'IconButton' | 'EmptyState' | 'Toast' | 'Dialog'>;
}) {
  const { locale, ui: { ConflictTaskProgress } } = useReviewRendererHost();
  const { records, error, pending, retry, restore, remove } = useArchivedGitConflicts(client);
  const [selected, setSelected] = useState<WorkspaceGitConflictTask | null>(null);
  const { Section, Group, Row, Button, IconButton, EmptyState, Toast, Dialog } = ui;
  const labels = {
    pull: t('feature.review.git.conflictPull'), rebase: t('feature.review.git.conflictRebase'), sync: t('feature.review.git.conflictSync'),
  };

  return (
    <Section featureId="desktop-review">
      <Group title={t('feature.review.git.archivedConflictSettings')}>
        {records === null && !error ? <p role="status">{t('feature.review.history.loading')}</p> : null}
        {error ? <>
          <Toast tone="error" message={t('feature.review.git.archivedConflictsError', { error })} />
          <Button disabled={pending} onClick={retry}>{t('feature.review.git.promptReload')}</Button>
        </> : null}
        {records?.map((task) => <Row className="git-conflict-archive-row" key={task.turnId} icon={<Archive size={15} />} label={labels[task.operation]}
          description={<>
            <span className="git-conflict-archive-path" title={task.workspaceRoot}>{task.workspaceRoot}</span>
            <span>{new Date(task.createdAt).toLocaleString(locale)}</span>
          </>}>
          <div className="git-conflict-archive-actions">
            <Button icon={<Eye size={14} />} onClick={() => setSelected(task)}>{t('feature.review.git.viewArchivedConflict')}</Button>
            <Button icon={<Undo2 size={14} />} disabled={pending} onClick={() => { void restore(task); }}>{t('feature.review.git.restoreConflict')}</Button>
            <Popconfirm title={t('feature.review.git.deleteConflictTitle', { title: labels[task.operation] })}
              description={t('feature.review.git.deleteConflictDescription')} placement="topRight" disabled={pending}
              okText={t('feature.review.git.deleteConflict')} cancelText={t('feature.review.git.deleteConflictCancel')} okButtonProps={{ danger: true }}
              onConfirm={async () => {
                if (await remove(task) && selected?.turnId === task.turnId) setSelected(null);
              }}>
              <IconButton label={t('feature.review.git.deleteConflict')} variant="danger" disabled={pending}><Trash2 size={14} /></IconButton>
            </Popconfirm>
          </div>
        </Row>)}
        {records?.length === 0 ? <EmptyState title={t('feature.review.git.noArchivedConflicts')} /> : null}
      </Group>
      {selected ? <Dialog size="large" title={labels[selected.operation]} subtitle={selected.workspaceRoot}
        closeLabel={t('feature.review.git.archivePreviewClose')} onClose={() => setSelected(null)}>
        <div className="desktop-review-panel git-conflict-archive-preview">
          <ConflictTaskProgress {...selected} onBack={() => setSelected(null)} onFinished={() => undefined} />
        </div>
      </Dialog> : null}
    </Section>
  );
}

import { ArchiveRow, ArchiveSection, ConfirmDialogTrigger } from '@setsuna-desktop/renderer-ui';
import { GitMerge, Eye, Trash2, Undo2 } from 'lucide-react';
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
  ui: Pick<SettingsViewUi, 'Section' | 'Button' | 'IconButton' | 'Toast' | 'Dialog'>;
}) {
  const { locale, ui: { ConflictTaskProgress } } = useReviewRendererHost();
  const { records, error, pending, retry, restore, remove } = useArchivedGitConflicts(client);
  const [selected, setSelected] = useState<WorkspaceGitConflictTask | null>(null);
  const { Section, Button, IconButton, Toast, Dialog } = ui;
  const labels = {
    pull: t('feature.review.git.conflictPull'), rebase: t('feature.review.git.conflictRebase'), sync: t('feature.review.git.conflictSync'),
  };

  return (
    <Section featureId="desktop-review">
      <ArchiveSection title={t('feature.review.git.archivedConflictSettings')}
        emptyLabel={records?.length === 0 && !error ? t('feature.review.git.noArchivedConflicts') : undefined}>
        {records === null && !error ? <div className="sd-archive__status" role="status">{t('feature.review.history.loading')}</div> : null}
        {error ? <div className="sd-archive__status">
          <Button disabled={pending} onClick={retry}>{t('feature.review.git.promptReload')}</Button>
        </div> : null}
        {records?.map((task) => <ArchiveRow className="git-conflict-archive-row" key={task.turnId} icon={<GitMerge size={18} />} title={labels[task.operation]}
          metadata={<>
            <span title={task.workspaceRoot}>{task.workspaceRoot}</span>
            <time dateTime={task.createdAt}>{new Date(task.createdAt).toLocaleString(locale)}</time>
          </>}
          actions={<>
            <Button variant="ghost" icon={<Eye size={14} />} onClick={() => setSelected(task)}>{t('feature.review.git.viewArchivedConflict')}</Button>
            <Button variant="ghost" icon={<Undo2 size={14} />} disabled={pending}
              onClick={() => { void restore(task); }}>{t('feature.review.git.restoreConflict')}</Button>
            <ConfirmDialogTrigger title={t('feature.review.git.deleteConflictTitle', { title: labels[task.operation] })}
              description={t('feature.review.git.deleteConflictDescription')} disabled={pending}
              confirmLabel={t('feature.review.git.deleteConflict')} cancelLabel={t('feature.review.git.deleteConflictCancel')} danger
              onConfirm={async () => {
                if (await remove(task) && selected?.turnId === task.turnId) setSelected(null);
              }}>
              <IconButton className="sd-archive__delete" label={t('feature.review.git.deleteConflict')} disabled={pending}><Trash2 size={14} /></IconButton>
            </ConfirmDialogTrigger>
          </>} />)}
      </ArchiveSection>
      {error ? <Toast tone="error" message={t('feature.review.git.archivedConflictsError', { error })} /> : null}
      {selected ? <Dialog size="large" title={labels[selected.operation]} subtitle={selected.workspaceRoot}
        closeLabel={t('feature.review.git.archivePreviewClose')} onClose={() => setSelected(null)}>
        <div className="desktop-review-panel git-conflict-archive-preview">
          <ConflictTaskProgress {...selected} onBack={() => setSelected(null)} onFinished={() => undefined} />
        </div>
      </Dialog> : null}
    </Section>
  );
}

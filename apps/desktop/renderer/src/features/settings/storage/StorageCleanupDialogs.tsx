import type { DesktopStorageCleanupCategory, DesktopStorageUsage, RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { Button, Checkbox, ConfirmDialogTrigger, Dialog } from '@setsuna-desktop/renderer-ui';
import { useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { formatDataBytes } from '../data-root/dataRootFormat.js';
import type { cleanStorageSelection, StorageCleanupSelection } from './storageCleanup.js';
import { StorageThreadPicker } from './StorageThreadPicker.js';

type CleanupDialogProps = {
  working: boolean;
  error: string | null;
  onCleanup(selection: StorageCleanupSelection): Promise<Awaited<ReturnType<typeof cleanStorageSelection>> | null>;
  onClose(): void;
};

export function StorageHistoryDialog({ threads, working, error, onCleanup, onClose }: CleanupDialogProps & {
  threads: RuntimeThreadSummary[];
}) {
  const { t } = useI18n();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const eligible = new Set(threads.filter((thread) => !thread.activeTurnId).map((thread) => thread.id));
  const selected = selectedIds.filter((id) => eligible.has(id));
  const removeSelected = async () => {
    const result = await onCleanup({ threadIds: selected, categories: [] });
    if (!result) return;
    setSelectedIds((ids) => ids.filter((id) => !result.deletedThreadIds.includes(id)));
    if (!result.cancelled && !result.failedThreadIds.length) onClose();
  };

  return <Dialog title={t('storage.reviewHistory')} width={520} className="storage-review-dialog"
    dismissible={!working} onClose={onClose}
    footer={<StorageCleanupActions working={working} disabled={!selected.length} onClose={onClose}
      label={t('storage.deleteSelected')} onConfirm={removeSelected}
      description={t('storage.confirmHistory', { target: t('storage.selectedThreads', { count: selected.length }) })} />}>
    <StorageThreadPicker threads={threads} selectedIds={selected} disabled={working} onChange={setSelectedIds} />
    {error ? <p className="sd-control-error" role="alert">{error}</p> : null}
  </Dialog>;
}

export function StorageCachesDialog({ usage, working, error, onCleanup, onClose }: CleanupDialogProps & {
  usage: DesktopStorageUsage;
}) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<DesktopStorageCleanupCategory[]>([]);
  const categories = (['cache', 'logs'] as const).map((id) => ({
    id, totalBytes: usage.categories.find((item) => item.id === id)?.totalBytes ?? 0,
  }));
  const target = new Intl.ListFormat(locale).format(selected.map((id) => t(id === 'cache' ? 'storage.cache' : 'storage.logs')));
  const clearSelected = async () => {
    const result = await onCleanup({ threadIds: [], categories: selected });
    if (!result) return;
    setSelected(result.remainingCategories);
    if (!result.remainingCategories.length) onClose();
  };

  return <Dialog title={t('storage.cachesAndLogs')} width={520} className="storage-review-dialog"
    dismissible={!working} onClose={onClose}
    footer={<StorageCleanupActions working={working} disabled={!selected.length} onClose={onClose}
      label={t('storage.clean')} onConfirm={clearSelected} description={t('storage.confirmCaches', { target })} />}>
    <div className="storage-selection-list">
      {categories.map(({ id, totalBytes }) => <Checkbox key={id} className="storage-choice-row"
        checked={selected.includes(id)} disabled={working || !totalBytes}
        onChange={(checked) => setSelected((ids) => checked ? [...ids, id] : ids.filter((item) => item !== id))}>
        <span className="storage-choice-row__title">{t(id === 'cache' ? 'storage.cache' : 'storage.logs')}</span>
        <span className="storage-choice-row__meta">{formatDataBytes(totalBytes, locale)}</span>
      </Checkbox>)}
    </div>
    {error ? <p className="sd-control-error" role="alert">{error}</p> : null}
  </Dialog>;
}

function StorageCleanupActions({ working, disabled, label, description, onConfirm, onClose }: {
  working: boolean;
  disabled: boolean;
  label: string;
  description: string;
  onConfirm(): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  return <>
    <Button disabled={working} onClick={onClose}>{t('common.cancel')}</Button>
    <ConfirmDialogTrigger title={t('storage.confirmTitle')} description={description}
      confirmLabel={label} cancelLabel={t('common.cancel')} danger disabled={disabled || working} onConfirm={onConfirm}>
      <Button className="storage-delete" variant="danger" disabled={disabled || working} loading={working}>{label}</Button>
    </ConfirmDialogTrigger>
  </>;
}

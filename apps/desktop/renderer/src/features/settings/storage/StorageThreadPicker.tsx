import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { Checkbox, Button, SelectField, TextField } from '@setsuna-desktop/renderer-ui';
import { useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { filterStorageThreads, type StorageThreadFilter } from './storageThreads.js';

const PAGE_SIZE = 60;

export function StorageThreadPicker({ threads, selectedIds, disabled, onChange }: {
  threads: RuntimeThreadSummary[];
  selectedIds: string[];
  disabled: boolean;
  onChange(ids: string[]): void;
}) {
  const { locale, t } = useI18n();
  const [filter, setFilter] = useState<StorageThreadFilter>({ search: '', scope: 'all', olderThanDays: 0 });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [openedAt] = useState(Date.now);
  const visible = filterStorageThreads(threads, filter, openedAt);
  const eligible = visible.filter((thread) => !thread.activeTurnId);
  const selected = new Set(selectedIds);
  const selectedCount = eligible.filter((thread) => selected.has(thread.id)).length;
  const toggle = (ids: string[], checked: boolean) => {
    for (const id of ids) { if (checked) selected.add(id); else selected.delete(id); }
    onChange([...selected]);
  };
  const updateFilter = (patch: Partial<StorageThreadFilter>) => {
    setFilter((current) => ({ ...current, ...patch }));
    setLimit(PAGE_SIZE);
    // A changed filter starts a new review, so hidden selections cannot be deleted by surprise.
    onChange([]);
  };

  return <div className="storage-threads">
    <div className="storage-threads__filters">
      <label className="storage-filter-row">
        <span>{t('storage.lastUpdated')}</span>
        <SelectField aria-label={t('storage.lastUpdated')} value={String(filter.olderThanDays)} disabled={disabled}
          onValueChange={(value) => updateFilter({ olderThanDays: Number(value) })}>
          <option value="0">{t('storage.anyTime')}</option>
          <option value="30">{t('storage.overDays', { days: 30 })}</option>
          <option value="90">{t('storage.overDays', { days: 90 })}</option>
          <option value="365">{t('storage.overDays', { days: 365 })}</option>
        </SelectField>
      </label>
      <label className="storage-filter-row">
        <span>{t('storage.scope')}</span>
        <SelectField aria-label={t('storage.scope')} value={filter.scope} disabled={disabled}
          onValueChange={(value) => updateFilter({ scope: value === 'archived' ? 'archived' : 'all' })}>
          <option value="all">{t('storage.allThreads')}</option>
          <option value="archived">{t('storage.archivedThreads')}</option>
        </SelectField>
      </label>
    </div>
    <div className="storage-selection-list storage-threads__list">
      <div className="storage-threads__toolbar">
        <TextField aria-label={t('storage.search')} placeholder={t('storage.search')} value={filter.search} disabled={disabled}
          onChange={(event) => updateFilter({ search: event.target.value })} />
        <Checkbox aria-label={t('storage.selectFiltered')} title={t('storage.selectFiltered')}
          checked={eligible.length > 0 && selectedCount === eligible.length}
          indeterminate={selectedCount > 0 && selectedCount < eligible.length} disabled={disabled || !eligible.length}
          onChange={(checked) => toggle(eligible.map((thread) => thread.id), checked)} />
      </div>
      {visible.slice(0, limit).map((thread) => <Checkbox key={thread.id} className="storage-choice-row"
        checked={selected.has(thread.id)} disabled={disabled || Boolean(thread.activeTurnId)}
        title={thread.activeTurnId ? t('storage.runningThread') : thread.title}
        onChange={(checked) => toggle([thread.id], checked)}>
        <span className="storage-choice-row__title">{thread.title || t('settings.archives.untitled')}</span>
        <time className="storage-choice-row__meta" dateTime={thread.updatedAt}>{new Date(thread.updatedAt).toLocaleDateString(locale)}</time>
      </Checkbox>)}
      {!visible.length ? <div className="storage-threads__empty">{t('storage.noThreads')}</div> : null}
      {visible.length > limit ? <Button variant="ghost" disabled={disabled} onClick={() => setLimit((value) => value + PAGE_SIZE)}>{t('storage.showMore')}</Button> : null}
    </div>
  </div>;
}

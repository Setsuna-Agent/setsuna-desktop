import { Button, Checkbox, Dialog } from '@setsuna-desktop/renderer-ui';
import { useState } from 'react';
import { designStorageResourceKey, type DesignClient, type DesignStorageResource } from '../../../composition/design/DesignFeatureBoundary.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { formatDataBytes } from '../data-root/dataRootFormat.js';
import { StorageCleanupActions } from './StorageCleanupDialogs.js';
import { useDesignStorageCleanup } from './useDesignStorageCleanup.js';

const groups = [
  ['document', 'storage.localDesigns'], ['asset', 'storage.unusedDesignAssets'], ['font', 'storage.importedDesignFonts'],
] as const;

export function StorageDesignDialog({ client, onChange, onClose }: { client: DesignClient; onChange(): void; onClose(): void }) {
  const { t } = useI18n();
  const { inventory, loading, working, selected, toggle, clean, retry } = useDesignStorageCleanup(client, onChange);
  const removesFonts = inventory?.resources.some((item) => item.kind === 'font' && selected.has(designStorageResourceKey(item)));
  const description = t('storage.confirmDesign', { count: selected.size }) + (removesFonts ? ' ' + t('storage.confirmDesignFonts') : '');
  return <Dialog title={t('storage.cleanDesign')} width={520} className="storage-review-dialog"
    dismissible={!working} onClose={onClose}
    footer={<StorageCleanupActions working={working} disabled={loading || !selected.size} label={t('storage.deleteSelected')}
      description={description} onConfirm={clean} onClose={onClose} />}>
    {loading ? <div role="status">{t('common.loading')}</div> : !inventory
      ? <Button onClick={retry}>{t('storage.refresh')}</Button>
      : <div className="storage-design-list">
        {groups.map(([kind, label]) => {
          const items = inventory.resources.filter((item) => item.kind === kind);
          return items.length ? <DesignResourceGroup key={kind} label={t(label)} items={items}
            selected={selected} disabled={working} toggle={toggle} /> : null;
        })}
        {inventory.incomplete ? <p role="status">{t('storage.designIncomplete')}</p>
          : !inventory.resources.length ? <div className="storage-threads__empty">{t('storage.noDesignResources')}</div> : null}
      </div>}
  </Dialog>;
}

function DesignResourceGroup({ label, items, selected, disabled, toggle }: {
  label: string; items: DesignStorageResource[]; selected: ReadonlySet<string>; disabled: boolean;
  toggle(items: readonly DesignStorageResource[], checked: boolean): void;
}) {
  const { t, locale } = useI18n();
  const [limit, setLimit] = useState(80);
  const count = items.filter((item) => selected.has(designStorageResourceKey(item))).length;
  return <fieldset className="storage-selection-list">
    <legend><Checkbox checked={count === items.length} indeterminate={count > 0 && count < items.length}
      disabled={disabled} onChange={(checked) => toggle(items, checked)}>{label} ({items.length})</Checkbox></legend>
    {items.slice(0, limit).map((item) => {
      const key = designStorageResourceKey(item);
      const name = item.kind === 'font' ? item.name : item.path;
      return <Checkbox key={key} className="storage-choice-row" title={name} checked={selected.has(key)}
        disabled={disabled} onChange={(checked) => toggle([item], checked)}>
        <span className="storage-choice-row__title">{name}</span>
        {item.kind !== 'font' ? <span className="storage-choice-row__meta">{formatDataBytes(item.bytes, locale)}</span> : null}
      </Checkbox>;
    })}
    {items.length > limit ? <Button variant="ghost" disabled={disabled} onClick={() => setLimit((n) => n + 80)}>{t('storage.showMore')}</Button> : null}
  </fieldset>;
}

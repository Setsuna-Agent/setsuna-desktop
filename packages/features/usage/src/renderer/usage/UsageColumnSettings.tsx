import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Button, Checkbox, Dialog, IconButton, ToastNotice } from '@setsuna-desktop/renderer-ui';
import { USAGE_RECORD_COLUMNS, type UsageRecordColumnKey } from './usageRecordColumns.js';
import { useUsageView } from './view-context.js';
import './usage-columns.css';

type UsageColumnSettingsProps = {
  columns: readonly UsageRecordColumnKey[];
  onSave(columns: readonly UsageRecordColumnKey[]): void;
};

export function UsageColumnSettings(props: UsageColumnSettingsProps) {
  const { translate: t } = useUsageView();
  const [open, setOpen] = useState(false);
  return <>
    <IconButton label={t('feature.usage.displaySettings')} size="small" onClick={() => setOpen(true)}>
      <Settings size={16} aria-hidden="true" />
    </IconButton>
    {open ? <UsageColumnsDialog {...props} onClose={() => setOpen(false)} /> : null}
  </>;
}

function UsageColumnsDialog({ columns, onSave, onClose }: UsageColumnSettingsProps & { onClose(): void }) {
  const { translate: t } = useUsageView();
  const [draft, setDraft] = useState(columns);
  const [error, setError] = useState(false);
  const apply = () => {
    try {
      onSave(draft);
      onClose();
    } catch {
      setError(true);
    }
  };
  return <Dialog
    open
    width={480}
    title={t('feature.usage.displaySettings')}
    onClose={onClose}
    footer={<>
      <Button variant="secondary" onClick={onClose}>{t('feature.usage.cancel')}</Button>
      <Button variant="primary" disabled={!draft.length} onClick={apply}>{t('feature.usage.apply')}</Button>
    </>}
  >
    <div className="settings-usage-columns">
      <div className="settings-usage-columns__grid">
        {USAGE_RECORD_COLUMNS.map(({ key, label }) => (
          <Checkbox key={key} checked={draft.includes(key)} onChange={(checked) => {
            setDraft((current) => checked ? [...current, key] : current.filter((column) => column !== key));
          }}>{t(`feature.usage.${label}`)}</Checkbox>
        ))}
      </div>
      <div className="settings-usage-columns__selection">
        <span>{t('feature.usage.selectedColumns', { count: draft.length, total: USAGE_RECORD_COLUMNS.length })}</span>
        <Button variant="ghost" size="small" onClick={() => setDraft(USAGE_RECORD_COLUMNS.map(({ key }) => key))}>
          {t('feature.usage.selectAll')}
        </Button>
      </div>
    </div>
    {error ? <ToastNotice message={t('feature.usage.columnSaveFailed')} /> : null}
  </Dialog>;
}

import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Checkbox } from '../../../shared/ui/primitives.js';

export function DeleteSelectionBar({
  allChecked,
  disabled,
  indeterminate,
  loading,
  onCancel,
  onConfirm,
  onToggleAll,
  selectedCount,
  totalCount,
}: {
  allChecked: boolean;
  disabled: boolean;
  indeterminate: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onToggleAll: (checked: boolean) => void;
  selectedCount: number;
  totalCount: number;
}) {
  const { t } = useI18n();

  return (
    <div className="chat-delete-bar">
      <div className="chat-delete-bar__inner">
        <Checkbox
          checked={allChecked}
          className="chat-delete-bar__select-all"
          disabled={loading || totalCount === 0}
          indeterminate={indeterminate}
          onChange={onToggleAll}
        >
          <span>{t('chat.delete.selectAll')}</span>
        </Checkbox>
        <span className="chat-delete-bar__count">{t('chat.delete.selected', { count: selectedCount })}</span>
        <button type="button" className="chat-delete-bar__cancel" disabled={loading} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="chat-delete-bar__confirm" disabled={disabled} onClick={onConfirm}>
          {loading ? t('chat.delete.deleting') : t('common.delete')}
        </button>
      </div>
    </div>
  );
}

import { useLayoutEffect, useRef } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

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
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className="chat-delete-bar">
      <div className="chat-delete-bar__inner">
        <label className="chat-delete-bar__select-all">
          <input ref={checkboxRef} type="checkbox" checked={allChecked} disabled={loading || totalCount === 0} onChange={(event) => onToggleAll(event.currentTarget.checked)} />
          <span>{t('chat.delete.selectAll')}</span>
        </label>
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

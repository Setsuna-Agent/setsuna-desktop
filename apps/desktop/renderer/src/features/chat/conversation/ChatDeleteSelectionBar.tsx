import { Button, Checkbox } from '@setsuna-desktop/renderer-ui';
import { useEffect, useRef } from 'react';
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
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (loading) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const panel = barRef.current?.closest('main');
      if (!panel || (event.target instanceof Element && event.target !== document.body && !panel.contains(event.target))) return;
      // Nested controls and find own Escape before the conversation selection does.
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"], [role="listbox"], .sd-popover[data-state="open"]')
        || panel.querySelector('[role="search"]')) return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [loading, onCancel]);

  return (
    <div className="chat-delete-bar" ref={barRef}>
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
        <Button type="button" disabled={loading} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" type="button" disabled={disabled} loading={loading} onClick={onConfirm}>
          {loading ? t('chat.delete.deleting') : t('common.delete')}
        </Button>
      </div>
    </div>
  );
}

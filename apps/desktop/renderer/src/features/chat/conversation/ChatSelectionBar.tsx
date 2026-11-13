import type { DesktopConversationExportFormat } from '@setsuna-desktop/contracts';
import { Button, Checkbox, Dropdown } from '@setsuna-desktop/renderer-ui';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { ChatMessageSelectionMode } from '../hooks/useChatMessageSelection.js';

export function ChatSelectionBar({
  allChecked,
  disabled,
  indeterminate,
  loading,
  mode,
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
  mode: ChatMessageSelectionMode;
  onCancel: () => void;
  onConfirm: (format?: DesktopConversationExportFormat) => void;
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
    <div className="chat-selection-bar" ref={barRef}>
      <div className="chat-selection-bar__inner">
        <Checkbox
          checked={allChecked}
          className="chat-selection-bar__select-all"
          disabled={loading || totalCount === 0}
          indeterminate={indeterminate}
          onChange={onToggleAll}
        >
          <span>{t('chat.selection.selectAll')}</span>
        </Checkbox>
        <span className="chat-selection-bar__count">{t('chat.selection.selected', { count: selectedCount })}</span>
        <Button type="button" disabled={loading} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        {mode === 'delete' ? (
          <Button variant="danger" type="button" disabled={disabled} loading={loading} onClick={() => onConfirm()}>
            {loading ? t('chat.delete.deleting') : t('common.delete')}
          </Button>
        ) : (
          <Dropdown disabled={disabled} placement="topRight" menu={{ items: [
            { key: 'markdown', label: 'Markdown', onClick: () => onConfirm('markdown') },
            { key: 'html', label: 'HTML', onClick: () => onConfirm('html') },
            { key: 'png', label: t('chat.export.image'), onClick: () => onConfirm('png') },
          ] }}>
            <Button variant="primary" type="button" disabled={disabled} loading={loading}>
              {t(loading ? 'chat.export.exporting' : 'chat.export.action')}<ChevronDown size={14} />
            </Button>
          </Dropdown>
        )}
      </div>
    </div>
  );
}

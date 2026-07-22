import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function WorkspaceResizeHandle({
  max,
  min,
  onResizeStart,
  onResizeStep,
  value,
}: {
  max: number;
  min: number;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStep: (delta: number) => void;
  value: number;
}) {
  const { t } = useI18n();
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onResizeStep(16);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onResizeStep(-16);
    }
  };

  return (
    <button
      className="desktop-workspace-panel__resize-handle"
      type="button"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('workspace.resize.side')}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      title={t('workspace.resize.sideHint')}
      onKeyDown={handleKeyDown}
      onPointerDown={onResizeStart}
    />
  );
}

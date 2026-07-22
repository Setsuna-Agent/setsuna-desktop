import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

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
      aria-label="调整右侧面板宽度"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      title="拖拽调整右侧面板宽度"
      onKeyDown={handleKeyDown}
      onPointerDown={onResizeStart}
    />
  );
}

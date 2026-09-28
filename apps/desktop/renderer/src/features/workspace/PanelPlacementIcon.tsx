import type { DesktopPanelSlot } from './model.js';

export function PanelPlacementIcon({
  placement,
  size = 14,
}: {
  placement: DesktopPanelSlot;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`app-panel-placement-icon app-panel-placement-icon--${placement}`}
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width={size}
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      {placement === 'bottom' ? <path d="M3 14.5h18" /> : <path d="M15 4v16" />}
    </svg>
  );
}

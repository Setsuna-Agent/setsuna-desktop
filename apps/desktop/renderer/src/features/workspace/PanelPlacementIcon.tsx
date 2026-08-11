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
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      {placement === 'bottom' ? (
        <>
          <rect x="2.5" y="4" width="19" height="16" rx="2" />
          <path d="M2.5 14.5h19" />
        </>
      ) : (
        <>
          <rect x="4" y="2.5" width="16" height="19" rx="2" />
          <path d="M14.5 2.5v19" />
        </>
      )}
    </svg>
  );
}

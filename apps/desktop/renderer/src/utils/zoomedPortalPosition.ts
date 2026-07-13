export type ZoomedPortalPosition = {
  left: number;
  top: number;
};

export type ZoomedPortalPositionInput = {
  anchorX: number;
  anchorY: number;
  horizontalAlign?: 'end' | 'start';
  menuHeight: number;
  menuWidth: number;
  offsetX?: number;
  offsetY?: number;
  scaleInverse?: number;
  viewportHeight: number;
  viewportWidth: number;
  viewportGutter?: number;
};

/**
 * Converts visual viewport coordinates into the pre-zoom CSS coordinate space
 * used by fixed portals mounted under the zoomed document body.
 */
export function zoomedPortalPosition({
  anchorX,
  anchorY,
  horizontalAlign = 'start',
  menuHeight,
  menuWidth,
  offsetX = 0,
  offsetY = 0,
  scaleInverse = 1,
  viewportHeight,
  viewportWidth,
  viewportGutter = 8,
}: ZoomedPortalPositionInput): ZoomedPortalPosition {
  const safeScaleInverse = Number.isFinite(scaleInverse) && scaleInverse > 0 ? scaleInverse : 1;
  const appViewportWidth = viewportWidth * safeScaleInverse;
  const appViewportHeight = viewportHeight * safeScaleInverse;
  const appAnchorX = anchorX * safeScaleInverse;
  const appAnchorY = anchorY * safeScaleInverse;
  const desiredLeft = (horizontalAlign === 'end' ? appAnchorX - menuWidth : appAnchorX) + offsetX;
  const desiredTop = appAnchorY + offsetY;
  const maxLeft = Math.max(viewportGutter, appViewportWidth - menuWidth - viewportGutter);
  const maxTop = Math.max(viewportGutter, appViewportHeight - menuHeight - viewportGutter);

  return {
    left: Math.min(Math.max(viewportGutter, desiredLeft), maxLeft),
    top: Math.min(Math.max(viewportGutter, desiredTop), maxTop),
  };
}

export function pageScaleInverse(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 1;
  const value = Number.parseFloat(
    window.getComputedStyle(document.documentElement).getPropertyValue('--app-page-scale-inverse'),
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
}

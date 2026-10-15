type ScalableSheet = {
  getScale(): number;
  setScale(scale: number): void;
};

export function readOfficePageScale(): number {
  const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-page-scale'));
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function observeOfficeSheetScale(viewer: ScalableSheet, initialPageScale: number): () => void {
  let pageScale = initialPageScale;
  const observer = new MutationObserver(() => {
    const nextPageScale = readOfficePageScale();
    if (nextPageScale === pageScale) return;
    // Use the engine's zoom so it redraws and hit-tests in the same pixel space.
    // Applying the ratio also retains any zoom the user made inside the sheet.
    const nextScale = viewer.getScale() * nextPageScale / pageScale;
    pageScale = nextPageScale;
    viewer.setScale(nextScale);
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-font-size'] });
  return () => observer.disconnect();
}

export const composerCursorOffsetAdjustmentAttribute = 'data-composer-cursor-offset-adjustment';

type CursorOffsetAdjustment = number | string | null | undefined;

export function composerCursorOffsetAdjustment(serializedText: string, renderedText: string): number {
  return serializedText.length - renderedText.length;
}

export function applyComposerCursorOffsetAdjustments(
  visibleOffset: number,
  adjustments: Iterable<CursorOffsetAdjustment>,
): number {
  let serializedOffset = visibleOffset;
  for (const adjustment of adjustments) {
    const parsedAdjustment = typeof adjustment === 'number'
      ? adjustment
      : typeof adjustment === 'string' && adjustment.trim()
        ? Number(adjustment)
        : Number.NaN;
    if (Number.isFinite(parsedAdjustment)) serializedOffset += parsedAdjustment;
  }
  return Math.max(0, serializedOffset);
}

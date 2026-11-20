import type { DesignDocument, DesignNode, DesignPaint, DesignStyle, DesignTypography } from './document.js';
import { createDesignVariableResolver } from './design-variable-aliases.js';
import type { DesignVariableModeIds } from './design-variable-collections.js';
import {
  designVariableValue, resolveDesignNodeVariables, resolveDesignVariableTarget, withDesignVariableValue,
} from './design-variables.js';

export function designTypographyOf({ fontSize, fontFamily, fontWeight, fontStyle, lineHeight, letterSpacing, textAlign }: DesignTypography): DesignTypography {
  return { fontSize, fontFamily, fontWeight, fontStyle, lineHeight, letterSpacing, textAlign };
}

export function resolveDesignNodeStyles(
  node: DesignNode, styles: DesignDocument['styles'], detachId?: string,
): DesignNode {
  if (!styles) return node;
  return resolveDesignNodeVariables(resolveDesignNodeAppearance(node, styles, detachId), styles, detachId);
}

function lookupStyle(styles: DesignDocument['styles'], id: string | undefined, detachId?: string) {
  return id && styles && (!detachId || id === detachId) && Object.hasOwn(styles, id) ? styles[id] : undefined;
}

function resolveColor<T extends { color?: string; styleId?: string }>(value: T, styles: DesignDocument['styles'], detachId?: string): T {
  const shared = lookupStyle(styles, value.styleId, detachId);
  return shared?.kind === 'color' ? { ...value, color: shared.color, styleId: detachId ? undefined : value.styleId } : value;
}

export function resolveDesignPaintStyles<T extends DesignPaint>(paint: T, styles: DesignDocument['styles'], detachId?: string): T {
  if (!styles) return paint;
  const resolved = resolveColor(paint, styles, detachId);
  const gradient = paint.gradient;
  if (!gradient) return resolved;
  const stops = gradient.stops.map((stop) => resolveColor(stop, styles, detachId));
  return stops.some((stop, index) => stop !== gradient.stops[index]) ? { ...resolved, gradient: { ...gradient, stops } } : resolved;
}

function resolveDesignNodeAppearance(node: DesignNode, styles: NonNullable<DesignDocument['styles']>, detachId?: string): DesignNode {
  const strokes = node.strokes?.map((stroke) => resolveDesignPaintStyles(stroke, styles, detachId));
  const shadow = node.shadow && resolveColor(node.shadow, styles, detachId);
  const changedStrokes = strokes?.some((stroke, index) => stroke !== node.strokes?.[index]);
  const appearance = changedStrokes || shadow !== node.shadow ? { ...node, strokes: changedStrokes ? strokes : node.strokes, shadow } : node;
  if (appearance.kind === 'image') return appearance;
  const fills = appearance.fills?.map((fill) => resolveDesignPaintStyles(fill, styles, detachId));
  const resolved = fills?.some((fill, index) => fill !== appearance.fills?.[index]) ? { ...appearance, fills } : appearance;
  if (resolved.kind !== 'text') return resolved;
  const shared = lookupStyle(styles, resolved.textStyleId, detachId);
  const runs = resolved.runs?.map((run) => resolveColor(run, styles, detachId));
  const hasChangedRuns = runs?.some((run, index) => run !== resolved.runs?.[index]);
  return shared?.kind === 'text' ? { ...resolved, ...designTypographyOf(shared.typography), runs, textStyleId: detachId ? undefined : resolved.textStyleId }
    : hasChangedRuns ? { ...resolved, runs } : resolved;
}

export function designStylesForModes(styles: DesignDocument['styles'], documentId: string, modes?: DesignVariableModeIds): DesignDocument['styles'] {
  if (!styles) return;
  let resolved: Record<string, DesignStyle> | undefined;
  const entries = Object.entries(styles);
  const resolveVariable = createDesignVariableResolver(styles, documentId, modes);
  for (const [id, style] of entries) {
    if (style.kind === 'text' || (!style.aliasId && (!modes || !style.modeValues))) continue;
    const value = resolveVariable(id);
    if (value !== undefined && value !== designVariableValue(style)) {
      (resolved ??= { ...styles })[id] = withDesignVariableValue(style, undefined, value);
    }
  }
  for (const [id, style] of entries) {
    if (style.kind !== 'text' || !style.typography.variableIds) continue;
    const typography = resolveDesignVariableTarget(style.typography, resolved ?? styles);
    if (typography !== style.typography) (resolved ??= { ...styles })[id] = { ...style, typography };
  }
  return resolved ?? styles;
}

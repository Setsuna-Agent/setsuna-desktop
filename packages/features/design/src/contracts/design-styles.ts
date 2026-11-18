import type { DesignDocument, DesignNode, DesignStyle, DesignTypography } from './document.js';

export function designTypographyOf({ fontSize, fontFamily, fontWeight, lineHeight, letterSpacing, textAlign }: DesignTypography): DesignTypography {
  return { fontSize, fontFamily, fontWeight, lineHeight, letterSpacing, textAlign };
}

export function resolveDesignNodeStyles(
  node: DesignNode, styles: NonNullable<DesignDocument['styles']>, detachId?: string,
): DesignNode {
  function style(id: string | undefined): DesignStyle | undefined {
    return id && (!detachId || id === detachId) && Object.hasOwn(styles, id) ? styles[id] : undefined;
  }
  function paint<T extends { color?: string; styleId?: string }>(value: T): T {
    const shared = style(value.styleId);
    return shared?.kind === 'color' ? { ...value, color: shared.color, styleId: detachId ? undefined : value.styleId } : value;
  }
  const strokes = node.strokes?.map(paint);
  const shadow = node.shadow && paint(node.shadow);
  const changedStrokes = strokes?.some((stroke, index) => stroke !== node.strokes?.[index]);
  const appearance = changedStrokes || shadow !== node.shadow ? { ...node, strokes: changedStrokes ? strokes : node.strokes, shadow } : node;
  if (appearance.kind === 'image') return appearance;
  const fills = appearance.fills?.map((fill) => {
    const resolved = paint(fill);
    const stops = fill.gradient?.stops.map(paint);
    return fill.gradient && stops?.some((stop, index) => stop !== fill.gradient?.stops[index])
      ? { ...resolved, gradient: { ...fill.gradient, stops } } : resolved;
  });
  const resolved = fills?.some((fill, index) => fill !== appearance.fills?.[index]) ? { ...appearance, fills } : appearance;
  if (resolved.kind !== 'text') return resolved;
  const shared = style(resolved.textStyleId);
  const runs = resolved.runs?.map(paint);
  const hasChangedRuns = runs?.some((run, index) => run !== resolved.runs?.[index]);
  return shared?.kind === 'text' ? { ...resolved, ...shared.typography, runs, textStyleId: detachId ? undefined : resolved.textStyleId }
    : hasChangedRuns ? { ...resolved, runs } : resolved;
}

export function resolveDesignStyles(document: DesignDocument): DesignDocument {
  const styles = document.styles;
  if (!styles || !Object.keys(styles).length) return document;
  return { ...document, nodes: Object.fromEntries(Object.entries(document.nodes).map(([id, node]) => [id, resolveDesignNodeStyles(node, styles)])) };
}

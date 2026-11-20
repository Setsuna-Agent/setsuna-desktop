import { useId } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designDefaultColor } from '../../contracts/design-color.js';
import { maxDesignFills, type DesignFill, type DesignNode } from '../../contracts/index.js';
import { InspectorSection, NumberField } from './DesignInspectorFields.js';
import { ColorField } from './DesignPaintField.js';
import { designFills } from '../design-paint.js';
import { bindDesignNumber, type InspectorFieldEdits } from './design-inspector-edit.js';

export type BatchLayer = Readonly<{ id: string; node: DesignNode; opacity: number }>;

export function DesignBatchFields({ layers, disabled, fieldEdits, translate: t }: Readonly<{
  layers: readonly BatchLayer[]; disabled: boolean; fieldEdits: InspectorFieldEdits;
  translate: RendererTranslate;
}>) {
  const colorOwner = useId();
  if (!layers.length) return null;
  const nodes = layers.map(({ node }) => node);
  const canFill = nodes.every((node) => node.kind !== 'image' && (node.kind !== 'frame' || !node.instanceOf));
  const canRound = nodes.every((node) => node.kind === 'rectangle' || (node.kind === 'frame' && !node.instanceOf));
  const canSize = nodes.every((node) => node.kind === 'text');
  const fills = canFill ? nodes.map((node) => {
    const paints = designFills(node);
    const visible = paints[topVisibleFill(paints)];
    const target = visible ?? (paints.length >= maxDesignFills ? paints.at(-1) : undefined);
    return { visible, target };
  }) : [];
  const colors = fills.map(({ visible }) => visible?.gradient || visible?.image ? undefined : visible?.color.toLowerCase());
  const linkedFill = fills.some(({ target }) => target?.styleId || target?.gradient?.stops.some((stop) => stop.styleId));
  const color = sameValue(colors);

  return <InspectorSection title={t('feature.design.appearance')}>
    <div className="design-inspector__pair">
      <NumberField label={t('feature.design.opacity')} prefix="%" min={0} max={100} readOnly={disabled}
        value={sameValue(layers.map(({ opacity }) => opacity * 100))}
        {...bindDesignNumber(fieldEdits, (node, value) => ({ ...node, opacity: value / 100 }))} />
      {canRound ? <NumberField label={t('feature.design.cornerRadius')} prefix="◜" min={0} readOnly={disabled}
        value={sameValue(nodes.map((node) => node.kind === 'frame' || node.kind === 'rectangle'
          ? node.cornerRadii ? sameValue(node.cornerRadii) : node.cornerRadius ?? 0 : undefined))}
        {...bindDesignNumber(fieldEdits, (node, cornerRadius) => node.kind === 'frame' || node.kind === 'rectangle'
          ? { ...node, cornerRadius, cornerRadii: undefined } : node)} /> : null}
      {canSize ? <NumberField label={t('feature.design.fontSize')} min={1} readOnly={disabled}
        value={sameValue(nodes.map((node) => node.kind === 'text' ? node.fontSize : undefined))}
        {...bindDesignNumber(fieldEdits, (node, fontSize) => node.kind === 'text' ? { ...node, fontSize } : node)} /> : null}
    </div>
    {canFill ? <ColorField label={t('feature.design.fill')} value={color ?? colors.find((entry) => entry !== undefined) ?? designDefaultColor}
      mixed={color === undefined} disabled={disabled || linkedFill}
      onPreview={(next) => fieldEdits.onFieldPreview(colorOwner, next === undefined ? undefined : (node) => recolor(node, next))}
      onSave={(next) => fieldEdits.onFieldSave((node) => recolor(node, next))} /> : null}
  </InspectorSection>;
}

function sameValue<T>(items: readonly T[]): T | undefined {
  const first = items[0];
  return items.every((item) => Object.is(item, first)) ? first : undefined;
}

function topVisibleFill(fills: readonly DesignFill[]) {
  for (let index = fills.length - 1; index >= 0; index -= 1) if (!fills[index].hidden) return index;
  return -1;
}

function recolor(node: DesignNode, color: string): DesignNode {
  if (node.kind === 'image') return node;
  const fills = [...designFills(node)];
  const index = topVisibleFill(fills);
  if (index >= 0) fills[index] = { ...fills[index], color, styleId: undefined, gradient: undefined, image: undefined };
  else if (fills.length < maxDesignFills) fills.push({ color });
  else fills[fills.length - 1] = { ...fills[fills.length - 1], color, styleId: undefined, gradient: undefined, image: undefined, hidden: false };
  return { ...node, fills };
}

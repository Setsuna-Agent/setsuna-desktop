import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designFrameFill, maxDesignFills, type DesignNode } from '../../contracts/index.js';
import { InspectorSection, NumberField, PaintField } from './DesignInspectorFields.js';
import { designFills } from '../design-paint.js';

export type BatchLayer = Readonly<{ id: string; node: DesignNode; opacity: number }>;

export function DesignBatchFields({ layers, disabled, onSave, onPreview, translate: t }: Readonly<{
  layers: readonly BatchLayer[]; disabled: boolean;
  onSave(nodes: ReadonlyMap<string, DesignNode>): Promise<boolean>;
  onPreview(nodes: ReadonlyMap<string, DesignNode> | undefined): void;
  translate: RendererTranslate;
}>) {
  if (!layers.length) return null;
  const nodes = layers.map(({ node }) => node);
  const canFill = nodes.every((node) => node.kind !== 'image' && (node.kind !== 'frame' || !node.instanceOf));
  const canRound = nodes.every((node) => node.kind === 'rectangle' || (node.kind === 'frame' && !node.instanceOf));
  const canSize = nodes.every((node) => node.kind === 'text');
  const colors = canFill ? nodes.map((node) => {
    const fill = designFills(node)[topVisibleFill(node)];
    return fill?.gradient || fill?.image ? undefined : fill?.color.toLowerCase();
  }) : [];
  const color = sameValue(colors);
  const changes = (map: (node: DesignNode) => DesignNode) => new Map(layers.map(({ id, node }) => [id, map(node)]));

  return <InspectorSection title={t('feature.design.appearance')}>
    <div className="design-inspector__pair">
      <NumberField label={t('feature.design.opacity')} prefix="%" min={0} max={100} readOnly={disabled}
        value={sameValue(layers.map(({ opacity }) => opacity * 100))}
        onSave={(value) => onSave(changes((node) => ({ ...node, opacity: value / 100 })))} />
      {canRound ? <NumberField label={t('feature.design.cornerRadius')} prefix="◜" min={0} readOnly={disabled}
        value={sameValue(nodes.map((node) => node.kind === 'frame' || node.kind === 'rectangle'
          ? node.cornerRadii ? sameValue(node.cornerRadii) : node.cornerRadius ?? 0 : undefined))}
        onSave={(cornerRadius) => onSave(changes((node) => node.kind === 'frame' || node.kind === 'rectangle'
          ? { ...node, cornerRadius, cornerRadii: undefined } : node))} /> : null}
      {canSize ? <NumberField label={t('feature.design.fontSize')} min={1} readOnly={disabled}
        value={sameValue(nodes.map((node) => node.kind === 'text' ? node.fontSize : undefined))}
        onSave={(fontSize) => onSave(changes((node) => node.kind === 'text' ? { ...node, fontSize } : node))} /> : null}
    </div>
    {canFill ? <div className="design-inspector__paint-controls design-inspector__paint-controls--batch">
      <PaintField label={t('feature.design.fill')} value={color ?? colors.find((entry) => entry !== undefined) ?? designFrameFill}
        mixed={color === undefined} disabled={disabled}
        onPreview={(next) => onPreview(next === undefined ? undefined : changes((node) => recolor(node, next)))}
        onSave={(next) => onSave(changes((node) => recolor(node, next)))} />
    </div> : null}
  </InspectorSection>;
}

function sameValue<T>(items: readonly T[]): T | undefined {
  const first = items[0];
  return items.every((item) => Object.is(item, first)) ? first : undefined;
}

function topVisibleFill(node: DesignNode) {
  const fills = designFills(node);
  for (let index = fills.length - 1; index >= 0; index -= 1) if (!fills[index].hidden) return index;
  return -1;
}

function recolor(node: DesignNode, color: string): DesignNode {
  if (node.kind === 'image') return node;
  const fills = [...designFills(node)];
  const index = topVisibleFill(node);
  if (index >= 0) fills[index] = { ...fills[index], color, styleId: undefined, gradient: undefined, image: undefined };
  else if (fills.length < maxDesignFills) fills.push({ color });
  else fills[fills.length - 1] = { ...fills[fills.length - 1], color, styleId: undefined, gradient: undefined, image: undefined, hidden: false };
  return { ...node, fills };
}

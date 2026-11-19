import { useContext } from 'react';
import type { DesignDocument, DesignGradient, DesignNode } from '../../contracts/index.js';
import type { DesignScene } from '../design-layout.js';
import type { DesignPaintPreview } from '../design-paint.js';
import { designGradientPaintSpace } from './design-gradient-geometry.js';
import { DesignGradientSessionContext, designGradientFor, sortDesignGradientStops, withDesignGradient } from './DesignGradientSession.js';

export function useDesignCanvasGradient({ document, projected, scene, selectedId, revision, preview, visible, onSave }: Readonly<{
  document: DesignDocument;
  projected: DesignDocument;
  scene: DesignScene;
  selectedId?: string;
  revision: string;
  preview?: DesignPaintPreview;
  visible: boolean;
  onSave(id: string, node: DesignNode, revision: string): Promise<boolean>;
}>) {
  const access = useContext(DesignGradientSessionContext);
  const session = access?.session;
  if (!access || !session || !visible || selectedId !== session.target.layerId) return;
  const { target, owner, selectedStop: selected, draft } = session;
  const id = target.layerId;
  const node = document.nodes[id];
  const painted = projected.nodes[id];
  const pose = scene[id];
  if (!node || !painted || !pose?.visible || !pose.visibleBounds || pose.locked || !pose.width || !pose.height) return;
  const source = designGradientFor(node, target);
  const style = designGradientFor(painted, target);
  if (!source || !style) return;
  const active = draft && draft.source === source && draft.revision === revision ? draft.value : undefined;
  const previewNode = preview?.nodes.get(id);
  const inspectorPreview = previewNode && designGradientFor(previewNode, target);
  const value = active ?? inspectorPreview ?? source;
  const gradient = { ...value, stops: value.stops.map((stop) => {
    const color = stop.styleId && style.stops.find((candidate) => candidate.styleId === stop.styleId)?.color;
    return color ? { ...stop, color } : stop;
  }) };
  const space = designGradientPaintSpace(painted, pose, target);
  let selectedStop = Math.min(selected, source.stops.length - 1);
  if (!active && inspectorPreview) {
    const focused = value.stops.indexOf(source.stops[selectedStop]);
    const changed = value.stops.findIndex((stop) => !source.stops.includes(stop));
    selectedStop = focused >= 0 ? focused : Math.max(0, changed);
  }
  const paintPreview = active ? { revision, nodes: new Map([[id, withDesignGradient(node, target, active)]]) } : preview;
  return { key: `${owner}:${revision}`, paintPreview, guides: {
    source, gradient, pose, space, selectedStop,
    onSelectStop(index: number) {
      access.setSession((current) => current?.owner === owner ? { ...current, selectedStop: index } : current);
    },
    onPreview(value: DesignGradient | undefined) {
      access.setSession((current) => current?.owner === owner
        ? { ...current, draft: value ? { source, value, revision } : undefined } : current);
    },
    async onSave(value: DesignGradient, index: number) {
      const next = sortDesignGradientStops(value, index);
      let saved = false;
      try {
        saved = await onSave(id, withDesignGradient(node, target, next.value), revision);
      } finally {
        access.setSession((current) => current?.owner === owner && current.draft?.value === value
          ? { ...current, draft: undefined, selectedStop: saved ? next.selectedStop : current.selectedStop } : current);
      }
    },
  } };
}

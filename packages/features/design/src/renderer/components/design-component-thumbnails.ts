import type { Yoga } from 'yoga-layout/load';
import type { DesignDocument } from '../../contracts/index.js';
import { designResourceParts } from '../../contracts/design-resource-id.js';
import { resolveDesignScene, type DesignLayerBox, type DesignScene } from '../design-layout.js';
import { measureDesignText } from '../design-text.js';
import type { DesignExportSelection } from '../export/design-export-scene.js';
import { projectDesignComponents } from './design-components.js';
import { buildDesignLibraryResources, type DesignLibraryResources } from './design-library-resources.js';

export type DesignComponentPreviewContext = Readonly<{
  projected: DesignDocument;
  scene: DesignScene;
  resources: DesignLibraryResources;
  layoutEngine: Yoga;
}>;

type ComponentView = Pick<DesignExportSelection, 'document' | 'scene'>;

export function createDesignComponentThumbnailSelection(document: DesignDocument,
  { projected, scene, resources, layoutEngine }: DesignComponentPreviewContext,
): (id: string) => DesignExportSelection | undefined {
  const views = new Map<string, ComponentView>();
  const local = { document: projected, scene };

  return (id) => {
    const reference = designResourceParts(id);
    if (!reference) return componentSelection(local, id);
    const source = resources.documents.get(reference.documentId);
    if (!source) return;
    let view = views.get(reference.documentId);
    if (!view) {
      // Project the authored draft so a component keeps its source layout and variable modes.
      const linked = source.libraries ? [document, ...resources.documents.values()].filter((draft) => draft !== source) : [];
      const drawing = projectDesignComponents(source, buildDesignLibraryResources(source.documentId, linked));
      view = { document: drawing, scene: resolveDesignScene(layoutEngine, drawing, measureDesignText) };
      views.set(reference.documentId, view);
    }
    return componentSelection(view, reference.id);
  };
}

function componentSelection({ document, scene }: ComponentView, id: string): DesignExportSelection | undefined {
  if (!scene[id]) return;
  if (scene[id].visible) return { document, scene, ids: [id] };

  // A hidden master is still available for insertion. Keep hidden descendants out of its preview.
  const visible: Record<string, DesignLayerBox> = Object.create(scene);
  function reveal(layerId: string) {
    visible[layerId] = { ...scene[layerId], visible: true };
    const node = document.nodes[layerId];
    if (node.kind === 'frame') for (const child of node.childIds) {
      if (!document.nodes[child].hidden) reveal(child);
    }
  }
  reveal(id);
  return { document, scene: visible, ids: [id] };
}

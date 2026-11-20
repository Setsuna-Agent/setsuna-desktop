import type { Yoga } from 'yoga-layout/load';
import type { DesignDocument } from '../../contracts/index.js';
import { designResourceParts } from '../../contracts/design-resource-id.js';
import { resolveDesignScene } from '../design-layout.js';
import { measureDesignText } from '../design-text.js';
import type { DesignExportSelection } from '../export/design-export-scene.js';
import { projectDesignComponents } from './design-components.js';
import { buildDesignLibraryResources, type DesignLibraryResources } from './design-library-resources.js';

export type DesignComponentPreviewContext = Readonly<{
  projected: DesignDocument;
  resources: DesignLibraryResources;
  layoutEngine: Yoga;
}>;

export function createDesignComponentThumbnailSelection(document: DesignDocument,
  { projected, resources, layoutEngine }: DesignComponentPreviewContext,
): (id: string) => DesignExportSelection | undefined {
  const libraries = new Map<string, DesignDocument>();

  return (id) => {
    const reference = designResourceParts(id);
    if (!reference) return componentSelection(projected, id, layoutEngine);
    const source = resources.documents.get(reference.documentId);
    if (!source) return;
    let drawing = libraries.get(reference.documentId);
    if (!drawing) {
      // Resolve source-board variable modes before measuring the component on its own.
      const linked = source.libraries ? [document, ...resources.documents.values()].filter((draft) => draft !== source) : [];
      drawing = projectDesignComponents(source, buildDesignLibraryResources(source.documentId, linked));
      libraries.set(reference.documentId, drawing);
    }
    return componentSelection(drawing, reference.id, layoutEngine);
  };
}

function componentSelection(projected: DesignDocument, id: string, layoutEngine: Yoga): DesignExportSelection | undefined {
  const node = projected.nodes[id];
  if (node?.kind !== 'frame' || !node.component) return;

  // A fresh instance starts upright and outside the master's parent layout and clipping.
  const ids = [id];
  const document = node.hidden || node.rotation || node.flipX || node.flipY
    ? { ...projected, nodes: { ...projected.nodes, [id]: { ...node, hidden: false, rotation: 0, flipX: false, flipY: false } } }
    : projected;
  const scene = resolveDesignScene(layoutEngine, document, measureDesignText, { rootIds: ids });
  return { document, scene, ids };
}

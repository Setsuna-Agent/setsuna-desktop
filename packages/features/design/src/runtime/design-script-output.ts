import { designDocumentCodec, designDocumentVersion, designLayerImagePaths, designLayerShaderPaths } from '../contracts/index.js';

const scriptLayerKinds = new Set(['frame', 'rectangle', 'ellipse', 'text', 'vector']);
const maxLayers = 512;
const maxDepth = 16;

export function parseDesignScriptOutput(value: unknown) {
  if (!Array.isArray(value)) throw new Error('A canvas script must return an array of layers.');
  const nodes: Record<string, unknown> = {};
  let count = 0;
  function add(raw: unknown, depth: number): string {
    if (++count > maxLayers || depth > maxDepth) throw new Error('The script returned too many layers.');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid script layer.');
    const layer = raw as Record<string, unknown>;
    if (typeof layer.kind !== 'string' || !scriptLayerKinds.has(layer.kind) || layer.variableIds !== undefined
      || layer.component || layer.componentSet || layer.componentSlot || layer.instanceOf || layer.maskId || layer.interaction) {
      throw new Error('Unsupported script layer.');
    }
    const id = `layer-${count}`;
    if (layer.kind === 'frame') {
      const children = layer.children ?? [];
      if (!Array.isArray(children)) throw new Error('A script frame requires a children array.');
      nodes[id] = { ...layer, childIds: children.map((child) => add(child, depth + 1)) };
    } else nodes[id] = layer;
    return id;
  }
  const document = designDocumentCodec.parse({ schemaVersion: designDocumentVersion, documentId: 'script-output',
    rootIds: value.map((layer) => add(layer, 1)), nodes });
  if (Object.values(document.nodes).some((node) => designLayerImagePaths(node).length)) throw new Error('Canvas scripts cannot read image assets.');
  if (Object.values(document.nodes).some((node) => designLayerShaderPaths(node).length)) throw new Error('Canvas scripts cannot read GLSL assets.');
  return document;
}

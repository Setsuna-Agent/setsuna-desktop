import type { DesignDocument, DesignNode } from './document.js';

export function designPaintImagePaths(node: DesignNode, visibleOnly = false): readonly string[] {
  const paths: string[] = [];
  const fills = node.kind === 'image' ? undefined : node.fills;
  for (const stack of [fills, node.strokes]) {
    for (const paint of stack ?? []) {
      if (visibleOnly && (paint.hidden || paint.opacity === 0)) continue;
      if (paint.image) paths.push(paint.image.assetPath);
      for (const value of Object.values(paint.shader?.uniforms ?? {})) {
        if (typeof value === 'object' && 'kind' in value && value.kind === 'image' && value.assetPath) paths.push(value.assetPath);
      }
    }
  }
  return paths;
}

export function designLayerShaderPaths(node: DesignNode, visibleOnly = false): readonly string[] {
  if (node.kind === 'image') return [];
  return (node.fills ?? []).flatMap((paint) => paint.shader && (!visibleOnly || !paint.hidden && paint.opacity !== 0)
    ? [paint.shader.assetPath] : []);
}

export function designLayerImagePaths(node: DesignNode, visibleOnly = false): readonly string[] {
  const paths = designPaintImagePaths(node, visibleOnly);
  return node.kind === 'image' ? [node.assetPath, ...paths] : paths;
}

export function designDocumentImagePaths(document: DesignDocument): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const node of Object.values(document.nodes)) {
    for (const path of designLayerImagePaths(node)) paths.add(path);
    if (node.kind !== 'frame') continue;
    for (const override of Object.values(node.contentOverrides ?? {})) {
      if (override.kind === 'image') paths.add(override.assetPath);
    }
  }
  return paths;
}

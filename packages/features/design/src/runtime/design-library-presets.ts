import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { designDocumentCodec, type DesignDocument, type DesignNode, type DesignStyle } from '../contracts/document.js';
import { bundledDesignLibraryDocumentId, designLibraryDarkModeId, type DesignLibraryPresetId } from '../contracts/design-library-presets.js';
import { resolveDesignNodeStyles } from '../contracts/design-styles.js';
import { defaultVariableCollectionId, type DesignVariableCollection } from '../contracts/design-variable-collections.js';
import { withDesignVariableValue } from '../contracts/design-variables.js';
import type { DesignSnapshot } from '../contracts/operations.js';

const templates = new Map<DesignLibraryPresetId, Promise<DesignSnapshot>>();

export function readBundledDesignLibrary(presetId: DesignLibraryPresetId): Promise<DesignSnapshot> {
  const cached = templates.get(presetId);
  if (cached) return cached;
  const snapshot = readPresetSource(presetId).then((content) => {
    const document = designDocumentCodec.parse(JSON.parse(content));
    if (document.documentId !== bundledDesignLibraryDocumentId(presetId)) throw new Error('Invalid bundled design library identity.');
    const revision = createHash('sha256').update(content).digest('hex');
    return { document, revision, canUndo: false, canRedo: false };
  }).catch((error: unknown) => {
    templates.delete(presetId);
    throw error;
  });
  templates.set(presetId, snapshot);
  return snapshot;
}

function readPresetSource(presetId: DesignLibraryPresetId) {
  const filename = `${presetId}.design.json`;
  const resource = new URL(`../resources/design-libraries/${filename}`, import.meta.url);
  return readFile(resource, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT' || !process.env.SETSUNA_DESKTOP_DEV_SERVER_URL) throw error;
    // An already-running dev watcher may not have the build rule for the copied asset yet.
    const checkoutResource = new URL(`../../packages/features/design/src/resources/design-libraries/${filename}`, import.meta.url);
    return readFile(checkoutResource, 'utf8');
  });
}

export async function createPresetLibrary(presetId: DesignLibraryPresetId, documentId: string): Promise<DesignDocument> {
  return { ...(await readBundledDesignLibrary(presetId)).document, documentId };
}

export async function refreshPresetLibrary(presetId: DesignLibraryPresetId, source: DesignDocument): Promise<DesignDocument> {
  const { document: template } = await readBundledDesignLibrary(presetId);
  const colors = presetId === 'beui' ? refreshBeuiPrimaryColors(source, template) : source;
  const copy = addPresetDarkMode(colors, template);
  const roots: string[] = [];
  const nodes: Record<string, DesignNode> = {};
  const existingFrames = rootFrames(copy);
  const frameGap = 32;
  let nextFreeY: number | undefined;
  for (const rootId of template.rootIds) {
    if (Object.hasOwn(copy.nodes, rootId)) continue;
    const branch = branchIds(template, rootId);
    // Add whole component trees so an existing layer ID can never be overwritten or reparented.
    if (branch.some((id) => Object.hasOwn(copy.nodes, id))) continue;
    roots.push(rootId);
    for (const id of branch) nodes[id] = template.nodes[id];
    const root = nodes[rootId];
    if (root.kind === 'frame' && existingFrames.some((frame) => root.x < frame.x + frame.width && frame.x < root.x + root.width
      && root.y < frame.y + frame.height && frame.y < root.y + root.height)) {
      // An older copy can use a different layout. Keep those frames in place and put conflicting additions below the grid.
      nextFreeY ??= Math.max(...[...existingFrames, ...rootFrames(template)].map((frame) => frame.y + frame.height)) + frameGap;
      nodes[rootId] = { ...root, y: nextFreeY };
      nextFreeY += root.height + frameGap;
    }
  }
  const styles = missingEntries(template.styles, copy.styles);
  const collections = missingEntries(template.variableCollections, copy.variableCollections);
  if (roots.length === 0 && styles.length === 0 && collections.length === 0) return copy;

  return designDocumentCodec.parse({
    ...copy,
    rootIds: [...copy.rootIds, ...roots],
    nodes: { ...copy.nodes, ...nodes },
    styles: { ...copy.styles, ...Object.fromEntries(styles) },
    variableCollections: { ...copy.variableCollections, ...Object.fromEntries(collections) },
  });
}

function rootFrames(document: DesignDocument) {
  return document.rootIds.map((id) => document.nodes[id]).filter((node) => node.kind === 'frame');
}

function addPresetDarkMode(source: DesignDocument, template: DesignDocument): DesignDocument {
  const mode = designLibraryDarkModeId;
  const collections: Record<string, DesignVariableCollection> = {};
  const styles: Record<string, DesignStyle> = {};
  for (const [collectionId, preset] of Object.entries(template.variableCollections ?? {})) {
    const current = source.variableCollections?.[collectionId];
    const name = preset.modes?.[mode];
    if (!name || Object.hasOwn(current?.modes ?? {}, mode)) continue;

    for (const [id, style] of Object.entries(template.styles ?? {})) {
      if (style.kind === 'text' || (style.collectionId ?? defaultVariableCollectionId) !== collectionId) continue;
      const value = style.modeValues?.[mode];
      const existing = source.styles?.[id];
      if (value === undefined || !existing || existing.kind !== style.kind
        || (existing.collectionId ?? defaultVariableCollectionId) !== collectionId) continue;
      styles[id] = withDesignVariableValue(existing, mode, value);
    }
    collections[collectionId] = { ...preset, ...current, defaultModeName: current?.defaultModeName ?? preset.defaultModeName,
      modes: { ...current?.modes, [mode]: name } };
  }
  if (!Object.keys(collections).length) return source;
  const samples = collections[defaultVariableCollectionId] ? refreshPresetColorSamples(source, template, styles) : undefined;
  return { ...source, nodes: samples ? { ...source.nodes, ...samples.nodes } : source.nodes,
    styles: { ...source.styles, ...styles, ...samples?.styles }, variableCollections: { ...source.variableCollections, ...collections } };
}

function refreshPresetColorSamples(source: DesignDocument, template: DesignDocument, modeStyles: Readonly<Record<string, DesignStyle>>) {
  const nodes: Record<string, DesignNode> = {};
  const styles: Record<string, DesignStyle> = {};
  const prefix = 'preset-palette-hex-';
  // Add the bundled swatch bindings where the sample still has its original caption.
  for (const [id, layer] of Object.entries(template.nodes)) {
    if (layer.kind !== 'text') continue;
    const variableId = layer.variableIds?.text;
    if (!variableId?.startsWith(prefix)) continue;
    const previous = source.nodes[id];
    if (previous?.kind !== 'text' || previous.variableIds?.text) continue;
    const variable = template.styles?.[variableId];
    const existing = modeStyles[variableId] ?? source.styles?.[variableId];
    if (variable?.kind !== 'string' || (existing && existing.kind !== 'string')) continue;

    const colorId = `preset-color-${variableId.slice(prefix.length)}`;
    const swatch = modeStyles[colorId] ?? source.styles?.[colorId];
    if (swatch?.kind !== 'color') continue;
    const value = swatch.color.toUpperCase();
    if (previous.text !== layer.text && previous.text !== value) continue;
    const dark = swatch.modeValues?.[designLibraryDarkModeId];
    if (!dark) continue;
    if (!existing) styles[variableId] = { ...variable, value, modeValues: { [designLibraryDarkModeId]: dark.toUpperCase() } };
    nodes[id] = { ...previous, variableIds: { ...previous.variableIds, text: variableId } };
  }
  const deleteLabelId = 'alert-dialog-2-2-1';
  const label = source.nodes[deleteLabelId];
  const expected = template.nodes[deleteLabelId];
  const fill = label?.kind === 'text' ? label.fills?.[0] : undefined;
  const nextFill = expected?.kind === 'text' ? expected.fills?.[0] : undefined;
  // The two destructive button samples use the surface token as text on the danger fill.
  if (label?.kind === 'text' && label.fills?.length === 1 && fill?.styleId === 'preset-color-onInverse' && fill.color === '#f8fafc' && nextFill) {
    nodes[deleteLabelId] = { ...label, fills: [{ ...fill, color: nextFill.color, styleId: nextFill.styleId }] };
  }
  return { nodes, styles };
}

function refreshBeuiPrimaryColors(source: DesignDocument, template: DesignDocument): DesignDocument {
  const primaryId = 'preset-color-primary';
  const foregroundId = 'preset-color-primaryForeground';
  const primary = source.styles?.[primaryId];
  const foreground = source.styles?.[foregroundId];
  // Replace the generated pair together so project-specific palettes keep their contrast.
  if (!matchesPresetColor(primary, '#0285f7') || !matchesPresetColor(foreground, '#071522')) return source;
  const templatePrimary = template.styles?.[primaryId];
  const templateForeground = template.styles?.[foregroundId];
  if (templatePrimary?.kind !== 'color' || templateForeground?.kind !== 'color') return source;

  const colors = {
    [primaryId]: { ...primary, color: templatePrimary.color },
    [foregroundId]: { ...foreground, color: templateForeground.color },
  };
  const nodes = Object.fromEntries(Object.entries(source.nodes).map(([id, node]) => [id, resolveDesignNodeStyles(node, colors)]));
  const swatchLabelId = 'palette-2-3';
  const label = nodes[swatchLabelId];
  if (label?.kind === 'text' && label.text === primary.color.toUpperCase()) {
    nodes[swatchLabelId] = { ...label, text: templatePrimary.color.toUpperCase() };
  }
  return { ...source, nodes, styles: { ...source.styles, ...colors } };
}

function matchesPresetColor(style: DesignStyle | undefined, color: string): style is Extract<DesignStyle, { kind: 'color' }> {
  return style?.kind === 'color' && style.color === color && !style.aliasId && !style.modeValues;
}

function branchIds(document: DesignDocument, rootId: string) {
  const ids = [rootId];
  for (let index = 0; index < ids.length; index += 1) {
    const node = document.nodes[ids[index]];
    if (node.kind === 'frame') ids.push(...node.childIds);
  }
  return ids;
}

function missingEntries<T>(template?: Readonly<Record<string, T>>, projectCopy?: Readonly<Record<string, T>>) {
  return Object.entries(template ?? {}).filter(([id]) => !projectCopy || !Object.hasOwn(projectCopy, id));
}

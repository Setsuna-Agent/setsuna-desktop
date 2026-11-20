import { useRef } from 'react';
import type { Yoga } from 'yoga-layout/load';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { designLayerImagePaths, designLayerShaderPaths, type DesignDocument, type DesignDocumentRef, type DesignEdit, type DesignFrame } from '../../contracts/index.js';
import type { DesignAssets } from '../client.js';
import { previewDesignNode, type InspectorFieldEdits } from '../inspector/design-inspector-edit.js';
import type { ComponentActions } from '../components/DesignComponentActions.js';
import { detachDesignInstance } from '../components/design-components.js';
import { changeDesignVariant, createDesignVariant, designComponentDefinitions, designComponentVariants, planDesignComponentInsertion } from '../components/design-library.js';
import { designResourceNode, linkedDesignPath, type DesignLibraryResources } from '../components/design-library-resources.js';
import { canGroupDesignLayers, changeDesignLayout, groupDesignLayers, orderDesignBranches, selectedBranches, ungroupDesignLayer } from '../design-canvas-edits.js';
import { toWorld, unionBounds, type Bounds, type Point } from '../design-geometry.js';
import { resolveDesignInsertion } from '../design-insertion.js';
import type { DesignScene } from '../design-layout.js';
import { copyDesignBranches, designClipboardSharesRoot, parseDesignClipboard, pasteDesignBranches } from './design-layer-clipboard.js';
import { canContainDesignLayers, defaultDesignAutoLayout, restackDesignLayers, type DesignLayerActions } from './design-layer-commands.js';
import { isClosedDesignShape } from '../vectors/design-shape-outline.js';

export type DesignLayerMenuTarget = Readonly<{ id: string | null; point: Point; world?: Point }>;

export function useDesignLayerActions({ document, projected, resources, scene, layoutEngine, selectedIds, documentRef, output, getInsertionArea, onSelect, onLocate, onOpenLibrary, commit, fieldEdits, translate: t }: Readonly<{
  document: DesignDocument;
  projected: DesignDocument;
  resources: DesignLibraryResources;
  scene: DesignScene;
  layoutEngine: Yoga;
  selectedIds: readonly string[];
  documentRef: DesignDocumentRef;
  output: DesignAssets['output'];
  getInsertionArea(): Bounds | undefined;
  onSelect(ids: readonly string[]): void;
  onLocate(id: string): void;
  onOpenLibrary?(path: string): void;
  commit(edits: readonly DesignEdit[]): Promise<boolean>;
  fieldEdits: InspectorFieldEdits;
  translate: RendererTranslate;
}>) {
  const toast = useToast();
  const clipboardPending = useRef(false);
  const combining = useRef(false);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const node = selectedId ? document.nodes[selectedId] : undefined;
  const frame = node?.kind === 'frame' ? node : undefined;
  const selectedBox = selectedId ? scene[selectedId] : undefined;
  const branches = selectedBranches(selectedIds, scene);
  const editable = branches.filter((id) => !scene[id].locked);
  const writableFrame = frame && !frame.instanceOf && !selectedBox?.locked ? frame : undefined;
  const canWrap = canGroupDesignLayers(projected, scene, branches);
  const canCreate = canWrap && !frame?.component && !frame?.instanceOf;
  const sourceId = frame?.instanceOf;
  const libraryPath = sourceId && linkedDesignPath(document, sourceId);
  const canDetach = sourceId && designResourceNode(document, sourceId, resources)?.kind === 'frame' && !selectedBox?.locked;
  const library = designComponentDefinitions(document, resources).map(({ id, node }) => ({ id,
    name: [node.name || t('feature.design.component'), node.variantName, linkedDesignPath(document, id)].filter(Boolean).join(' · '),
  }));

  async function apply(edits: readonly DesignEdit[], selected: readonly string[]) {
    if (await commit(edits)) onSelect(selected);
  }

  function wrap(name: string, frameProps?: Pick<DesignFrame, 'component' | 'group' | 'layout' | 'maskId'>) {
    const { id, edits } = groupDesignLayers(document, scene, branches, name, frameProps, projected);
    void apply(edits, [id]);
  }

  function create() {
    const baseName = node?.name || t('feature.design.component');
    let name = baseName;
    let suffix = 2;
    while (library.some((item) => item.name === name)) name = `${baseName} ${suffix++}`;
    if (selectedId && writableFrame) {
      void commit([{ kind: 'update', nodeId: selectedId, node: { ...writableFrame, name, component: true, group: undefined } }]);
    } else wrap(name, { component: true });
  }

  async function insertComponent(sourceId: string) {
    const placement = planDesignComponentInsertion({ document, projected, resources, scene, layoutEngine, sourceId,
      target: { area: getInsertionArea(), selectedId } });
    if (!placement) return false;
    const inserted = await commit(placement.edits);
    if (inserted) onLocate(placement.id);
    return inserted;
  }

  function detach() {
    if (selectedId && canDetach) void commit(detachDesignInstance(projected, selectedId));
  }

  function addVariant() {
    if (!selectedId || !selectedBox || !writableFrame?.component) return;
    const variants = designComponentVariants(document, selectedId);
    const presets = [t('feature.design.variant.loading'), t('feature.design.variant.disabled')];
    let number = variants.length + 1;
    let name = presets.find((name) => variants.every(({ node }) => node.variantName !== name)) ?? t('feature.design.variant.number', { number });
    while (variants.some(({ node }) => node.variantName === name)) name = t('feature.design.variant.number', { number: ++number });
    const familyBounds = unionBounds(variants.map(({ id }) => scene[id].paintBounds)) ?? selectedBox.paintBounds;
    const variant = createDesignVariant(document, selectedId, name, { x: familyBounds.x + familyBounds.width + 48, y: familyBounds.y });
    if (variant) void commit(variant.edits).then((saved) => { if (saved) onLocate(variant.id); });
  }

  async function clipboard(task: () => Promise<void>) {
    if (clipboardPending.current) return;
    clipboardPending.current = true;
    try { await task(); }
    catch (error) {
      toast.error(t('feature.design.clipboardFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally { clipboardPending.current = false; }
  }

  function copy() {
    void clipboard(async () => {
      const origin = unionBounds(branches.map((id) => scene[id].paintBounds));
      if (!origin) return;
      const ids = orderDesignBranches(document, branches);
      await output.copyDesignLayers(copyDesignBranches(documentRef, projected, scene, ids, origin));
      toast.success(t('feature.design.copied'));
    });
  }

  function paste(target: DesignLayerMenuTarget | undefined, replace: boolean) {
    const area = !target && !replace ? getInsertionArea() : undefined;
    void clipboard(async () => {
      const content = await output.readDesignLayers();
      if (!content) {
        if (target) toast.error(t('feature.design.emptyClipboard'));
        return;
      }
      const copied = parseDesignClipboard(content);
      if (!designClipboardSharesRoot(copied, documentRef)) {
        const nodes = Object.values(copied.document.nodes);
        if (nodes.some((item) => item.kind === 'script' && item.scriptPath)) {
          toast.error(t('feature.design.clipboardScriptRoot'));
          return;
        }
        if (nodes.some((item) => designLayerShaderPaths(item).length)) {
          toast.error(t('feature.design.clipboardShaderRoot'));
          return;
        }
        if (nodes.some((item) => designLayerImagePaths(item).length)) {
          toast.error(t('feature.design.clipboardImageRoot'));
          return;
        }
      }
      const id = target ? target.id : selectedId;
      const hit = id ? scene[id] : undefined;
      const inside = !replace && id && !hit?.locked && canContainDesignLayers(document.nodes[id]);
      const contextualParent = inside ? id : hit?.parentId ?? null;
      const copiedElements = copied.document.rootIds.some((root) => {
        const layer = copied.document.nodes[root];
        return layer.kind !== 'frame' || layer.group;
      });
      const fallback = area && !contextualParent && copiedElements ? resolveDesignInsertion(document, scene, area, selectedId) : undefined;
      const parentId = contextualParent ?? fallback?.parentId ?? null;
      const parent = parentId ? scene[parentId] : undefined;
      if (parent?.locked || (replace && (!id || hit?.locked))) return;
      const origin = replace && hit ? hit.paintBounds : target?.world ?? (inside
        ? toWorld(parent, { x: 24, y: 24 })
        : { x: (hit?.paintBounds.x ?? 0) + 16, y: (hit?.paintBounds.y ?? 0) + 16 });
      const parentNode = parentId ? document.nodes[parentId] : undefined;
      const absolute = replace && id ? document.nodes[id].absolute : parentNode?.kind === 'frame' && parentNode.layout ? Boolean(target?.world) : undefined;
      const placement = fallback?.parentId ? { center: fallback.center } : { origin };
      const { ids, edits } = pasteDesignBranches(copied, document, documentRef, { ...placement, parentId, parent, beforeId: replace ? id : null, absolute });
      if (replace && id && ids.length) edits.push({ kind: 'remove', nodeId: id });
      await apply(edits, ids);
    });
  }

  function flip(axis: 'flipX' | 'flipY') {
    void commit(editable.map((nodeId) => ({ kind: 'update', nodeId,
      node: { ...document.nodes[nodeId], [axis]: !document.nodes[nodeId][axis] } })));
  }

  async function combine(operation: 'union' | 'subtract', ids: readonly string[]) {
    if (combining.current) return;
    combining.current = true;
    try {
      const { combineDesignPaths } = await import('../vectors/design-path-boolean.js');
      const { id, edits } = await combineDesignPaths(document, scene, ids, operation, t('feature.design.path'));
      if (edits.length) await apply(edits, id ? [id] : []);
    } catch (error) {
      toast.error(t('feature.design.booleanFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      combining.current = false;
    }
  }

  function commands(target?: DesignLayerMenuTarget): DesignLayerActions {
    const targetId = target ? target.id : selectedId;
    const targetParentId = targetId ? scene[targetId]?.parentId : null;
    const stack = editable.length > 1 && editable.length === branches.length && canWrap ? orderDesignBranches(document, branches) : [];
    const maskId = stack.at(-1);
    const canCombine = stack.length > 1 && stack.every((id) => scene[id].visible && isClosedDesignShape(document.nodes[id]));
    return {
      copy: branches.length ? copy : undefined,
      paste: targetParentId && scene[targetParentId]?.locked ? undefined : () => paste(target, false),
      replace: targetId && targetId === selectedId && !selectedBox?.locked ? () => paste(target, true) : undefined,
      front: editable.length ? () => { void commit(restackDesignLayers(document, scene, editable, true)); } : undefined,
      back: editable.length ? () => { void commit(restackDesignLayers(document, scene, editable, false)); } : undefined,
      group: canWrap ? () => wrap(t('feature.design.group')) : undefined,
      frame: canWrap ? () => wrap(t('feature.design.frame'), {}) : undefined,
      ungroup: selectedId && writableFrame && !writableFrame.component && (writableFrame.group || writableFrame.childIds.length > 0)
        ? () => { void apply(ungroupDesignLayer(document, scene, selectedId, writableFrame, projected), writableFrame.childIds); } : undefined,
      addLayout: canWrap && !frame?.instanceOf && !frame?.layout ? () => {
        const layout = defaultDesignAutoLayout(scene, branches);
        if (writableFrame && selectedId) void commit(changeDesignLayout(document, scene, selectedId, writableFrame, layout));
        else wrap(t('feature.design.frame'), { layout });
      } : undefined,
      removeLayout: writableFrame?.layout && selectedId
        ? () => { void commit(changeDesignLayout(document, scene, selectedId, writableFrame, undefined)); } : undefined,
      component: canCreate ? create : undefined,
      detach: canDetach ? detach : undefined,
      mask: maskId && scene[maskId].visible && isClosedDesignShape(document.nodes[maskId])
        ? () => wrap(t('feature.design.mask'), { group: true, maskId }) : undefined,
      removeMask: writableFrame?.maskId && selectedId ? () => {
        void commit([{ kind: 'update', nodeId: selectedId, node: { ...writableFrame, maskId: undefined } }]);
      } : undefined,
      union: canCombine ? () => { void combine('union', stack); } : undefined,
      subtract: canCombine ? () => { void combine('subtract', stack); } : undefined,
      flipX: editable.length ? () => flip('flipX') : undefined,
      flipY: editable.length ? () => flip('flipY') : undefined,
      delete: editable.length ? () => { void commit(editable.map((nodeId) => ({ kind: 'remove', nodeId }))); } : undefined,
    };
  }

  const previewNode = previewDesignNode(fieldEdits);
  const variantNode = (id: string | undefined) => selectedId && id && id !== sourceId && !selectedBox?.locked
    ? changeDesignVariant(document, projected, selectedId, id, resources) : undefined;
  const components: ComponentActions = {
    canCreate, library, sourceId, onCreate: create, onInsert: insertComponent, librarySource: Boolean(libraryPath),
    onLocate: libraryPath ? onOpenLibrary && (() => onOpenLibrary(libraryPath)) : onLocate,
    onDetach: canDetach ? detach : undefined,
    definition: writableFrame?.component && selectedId ? {
      name: writableFrame.variantName ?? '', add: addVariant,
      onRename: (name) => /[\p{C}]/u.test(name) ? Promise.resolve(false)
        : commit([{ kind: 'update', nodeId: selectedId, node: { ...writableFrame, variantName: name.trim() || undefined } }]),
    } : undefined,
    variant: frame?.instanceOf && selectedId ? {
      instanceId: selectedId,
      value: frame.instanceOf,
      items: designComponentVariants(document, frame.instanceOf, resources).map(({ id, node }) =>
        ({ id, name: node.variantName ?? t('feature.design.variant.default') })),
      select: (id) => {
        const node = variantNode(id);
        if (node) void commit([{ kind: 'update', nodeId: selectedId, node }]);
      },
      preview: (id, owner) => previewNode(variantNode(id), owner),
    } : undefined,
  };
  return { commands, components, branches, editable, canWrap };
}

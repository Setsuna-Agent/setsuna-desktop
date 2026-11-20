import { workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designDocumentFileName, designFontFamilies, type DesignDocumentRef } from '../../contracts/index.js';
import type { DesignClient } from '../client.js';
import type { DesignCanvasSetting, DesignCanvasSettings } from '../context/design-canvas-settings.js';
import { copyDesignBranches } from '../context/design-layer-clipboard.js';
import { orderDesignBranches } from '../design-canvas-edits.js';
import { unionBounds } from '../design-geometry.js';
import type { DesignCanvasHandle } from '../DesignCanvas.js';
import type { DesignScriptResults } from '../canvas/design-script-layers.js';
import { designComponentDefinitions } from '../components/design-library.js';
import { designLibraryVariableCollections, designStyleChoices } from '../components/design-library-resources.js';
import type { DesignExportRequest } from '../export/use-design-exports.js';
import type { DesignCommandContext } from './design-command.js';
import type { DesignCommandKey } from '../../contracts/design-command-key.js';

export type DesignEditorTools = {
  client: DesignClient; ref: DesignDocumentRef; scripts: DesignScriptResults;
  translate: RendererTranslate;
  settings: DesignCanvasSettings; toggleSetting(key: DesignCanvasSetting): void;
  projects?: readonly WorkspaceProject[];
  canvas(): DesignCanvasHandle | null; select(ids: readonly string[]): void;
  completeFileAction?(destination?: DesignDocumentRef): void;
  refreshFonts(): Promise<void>;
  deliver(ids: readonly string[], request: DesignExportRequest, signal: AbortSignal, networkAccess: boolean): Promise<boolean>;
};

export function textArg(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected ' + field + '.');
  return value;
}
type Args = Record<string, unknown>;
export async function readDesignResources(view: DesignCommandContext, editor: DesignEditorTools, args: Args, signal: AbortSignal) {
  const { document, resources } = view;
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
  let values: unknown[];
  switch (args.kind) {
    case 'styles': values = Object.entries(designStyleChoices(document, resources) ?? {}); break;
    case 'collections': values = designLibraryVariableCollections(document, resources); break;
    case 'components': values = designComponentDefinitions(document, resources).map(({ id, node }) => ({ id, name: node.name, set: node.componentSet, variant: node.variantName })); break;
    case 'libraries': values = Object.entries(document.libraries ?? {}); break;
    case 'boards': values = document.rootIds.filter((id) => document.nodes[id].kind === 'frame').map((id) => ({ id, name: document.nodes[id].name })); break;
    case 'fonts': values = [...designFontFamilies, ...await editor.client.fonts.list(signal)]; break;
    case 'images': values = [...await editor.client.assets.search(editor.ref, query)]; break;
    case 'documents': values = [...await editor.client.list(editor.ref, signal)]; break;
    case 'brushes': {
      const { drawingPresets } = await import('../canvas/design-drawing.js');
      values = Object.entries(drawingPresets);
      break;
    }
    case 'scripts': values = (await import('../canvas/design-script-presets.js')).designScriptPresets.map(({ name }) => name); break;
    case 'shaders': values = (await import('../shaders/design-shader-presets.js')).designShaderPresets.map(({ name }) => name); break;
    case 'devices': values = [...editor.client.assets.webPreview?.devices ?? []]; break;
    case 'icons': values = Object.keys(await lucideCatalog()); break;
    default: throw new Error('Unknown resource collection.');
  }
  let filtered = values;
  if (query && args.kind === 'icons') {
    const names = values.filter((item): item is string => typeof item === 'string');
    filtered = args.exact === true ? names.filter((name) => name === query)
      : [...names.filter((name) => name === query), ...names.filter((name) => name !== query && name.includes(query))];
  } else if (query) filtered = values.filter((item) => JSON.stringify(item).toLowerCase().includes(query));
  const offset = args.offset ?? 0;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid resource offset.');
  return { items: filtered.slice(offset, offset + 64), total: filtered.length };
}

export async function lucideCatalog() {
  const { default: icons } = await import('lucide-react/dynamicIconImports.js');
  return (icons.default ?? icons) as Record<string, () => Promise<{ default: import('lucide-react').LucideIcon }>>;
}

export async function importDesignResource(editor: DesignEditorTools, args: Args, wholeDocument: boolean, signal: AbortSignal, command: DesignCommandKey) {
  const { client, ref } = editor;
  if (args.action === 'importFont' || args.action === 'removeFont') {
    if (!wholeDocument) throw new Error('Start a whole-document task to manage installed design fonts.');
    const font = args.action === 'importFont' ? await client.fonts.import(textArg(args.base64, 'font bytes'), signal)
      : await client.fonts.remove(textArg(args.id, 'font id'), signal, command);
    await editor.refreshFonts();
    return font;
  }
  if (args.action === 'linkedImage') {
    const url = textArg(args.url, 'HTTPS image URL');
    if (!/^https:\/\//iu.test(url)) throw new Error('Expected an HTTPS image URL.');
    const { importLocalDesignImage } = await import('../design-images.js');
    return importLocalDesignImage(await client.assets.readLinkedImage(url, signal), { ref, store: client.importImage, signal, translate: editor.translate });
  }
  const name = textArg(args.name, 'asset name');
  if (args.action === 'image') return client.importImage({ ref, name, base64: textArg(args.base64, 'image bytes') }, signal);
  const presets = args.action === 'script' && args.source === undefined ? (await import('../canvas/design-script-presets.js')).designScriptPresets
    : args.action === 'shader' && args.source === undefined ? (await import('../shaders/design-shader-presets.js')).designShaderPresets : [];
  const source = textArg(args.source ?? presets.find((preset) => preset.name === name)?.source, 'source or installed preset');
  if (args.action === 'script') return client.importScript({ ref, name, source }, signal);
  if (args.action === 'shader') return client.importShader({ ref, name, source }, signal);
  throw new Error('Unknown design asset operation.');
}

export async function exportDesignTask(view: DesignCommandContext, editor: DesignEditorTools, ids: readonly string[], args: Args, signal: AbortSignal, networkAccess: boolean) {
  if (args.format === 'layers' && args.action === 'copy') {
    const bounds = unionBounds(ids.map((id) => view.scene[id].paintBounds));
    if (!bounds) throw new Error('Choose layers to copy.');
    const content = copyDesignBranches(editor.ref, view.projected, view.scene, orderDesignBranches(view.projected, ids), bounds);
    signal.throwIfAborted();
    await editor.client.assets.output.copyDesignLayers(content);
    return true;
  }
  return editor.deliver(ids, exportRequest(args), signal, networkAccess);
}

function exportRequest(args: Args): DesignExportRequest {
  const { action, format } = args;
  if (action !== 'copy' && action !== 'save') throw new Error('Expected copy or save.');
  if (format === 'html' || format === 'html-tailwind') return { kind: 'code', format, action };
  if (format === 'svg' && action === 'save') return { kind: 'svg', action };
  const scale = args.scale ?? 1;
  if (format === 'png' && (scale === 1 || scale === 2 || scale === 3)) return { kind: 'image', action, scale };
  throw new Error('Unsupported design export.');
}

export async function manageDesignFile(editor: DesignEditorTools, args: Args, revision: string, signal: AbortSignal, command: DesignCommandKey) {
  const { client, ref, projects } = editor;
  if (args.action === 'destinations') return (projects ?? []).filter((project) => project.id !== ref.projectId).map((project) => ({ id: project.id, name: project.name,
    roots: workspaceProjectRoots(project).map(({ id, path }) => ({ id, path })) }));
  if (args.action === 'create') return client.create({ ...ref, name: designDocumentFileName(textArg(args.name, 'file name')), parentPath: '.', command }, signal);
  if (args.revision !== revision) throw new Error('Design revision changed. Inspect again.');
  if (args.action === 'delete') {
    await client.delete({ ...ref, expectedRevision: revision, command }, signal);
    signal.throwIfAborted();
    editor.completeFileAction?.();
    return { deleted: ref.path };
  }
  if (args.action === 'move') {
    const project = projects?.find((item) => item.id === args.projectId);
    const root = project && workspaceProjectRoots(project).find((item) => item.id === args.rootId);
    if (!project || !root || project.id === ref.projectId) throw new Error('Choose a bound destination from destinations.');
    const source = await client.resolveResourceRoot(ref, signal);
    const destination = await client.move({ ref: source, destination: { projectId: project.id, rootId: root.id }, expectedRevision: revision, command }, signal);
    signal.throwIfAborted();
    editor.completeFileAction?.(destination);
    return destination;
  }
  throw new Error('Unknown design file operation.');
}

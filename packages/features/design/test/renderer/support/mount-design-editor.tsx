import { ToastProvider, UiProvider } from '@setsuna-desktop/renderer-ui';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, vi } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { commitDesignEdits, type DesignDocument } from '../../../src/contracts/index.js';
import DesignEditor from '../../../src/renderer/DesignEditor.js';
import type { DesignAssets, DesignClient } from '../../../src/renderer/client.js';
import type { Bounds, Point } from '../../../src/renderer/design-geometry.js';
import { DesignDocumentService } from '../../../src/runtime/design-document-service.js';

const drawing = vi.hoisted(() => ({
  frameFills: new Map<string, string>(),
  localX: new Map<string, number>(),
  images: new Map<string, { image: HTMLImageElement; name?: string; crop?: Bounds }>(),
  exportedImages: new Map<string, HTMLImageElement>(),
  paths: new Map<string, string>(),
  pathStrokeWidths: new Map<string, number>(),
  handles: new Set<string>(),
  hit: undefined as string | undefined,
}));

export { drawing };

export function designDragTransfer() {
  const dataTransfer = new DataTransfer();
  vi.spyOn(dataTransfer, 'setDragImage').mockImplementation(() => {});
  return dataTransfer;
}

export function designDragEvent(type: 'dragstart' | 'dragover' | 'dragleave' | 'dragend' | 'drop', target: HTMLElement, dataTransfer: DataTransfer, point: Point) {
  // happy-dom omits mouse coordinates from DragEvent.
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return fireEvent(target, event);
}

vi.mock('react-konva', async () => {
  const { createContext, forwardRef, useContext, useImperativeHandle, useLayoutEffect, useMemo } = await import('react');
  const LayerId = createContext<string | undefined>(undefined);
  const StageImages = createContext<Map<string, HTMLImageElement> | undefined>(undefined);
  type Mount = { data: string; strokeWidth?: number };
  const mountedPaths = new Map<string, Set<Mount>>();
  const Container = ({ children }: PropsWithChildren) => <>{children}</>;
  const Stage = forwardRef(function Stage({ children }: PropsWithChildren, ref) {
    const stageImages = useMemo(() => new Map<string, HTMLImageElement>(), []);
    useImperativeHandle(ref, () => ({
      getLayers: () => [{ toCanvas() {
        drawing.exportedImages = new Map(stageImages);
        return { toDataURL: () => 'data:image/png;base64,AA==' };
      } }],
      getIntersection() {
        const hit = drawing.hit;
        const image = hit ? drawing.images.get(hit) : undefined;
        if (hit && image) return { hasName: (name: string) => name === image.name,
          findAncestor: () => ({ id: () => hit }), getAttr: (key: string) => key === 'image' ? image.image : undefined };
        if (hit && drawing.handles.has(hit)) return { hasName: (name: string) => name === hit, findAncestor: () => null };
        return hit && drawing.localX.has(hit) ? { hasName: () => false, findAncestor: () => ({ id: () => hit }) } : null;
      },
    }), [stageImages]);
    return <StageImages.Provider value={stageImages}>{children}</StageImages.Provider>;
  });
  function Group({ id, x = 0, offsetX = 0, children }: PropsWithChildren<{ id?: string; x?: number; offsetX?: number }>) {
    if (!id) return <>{children}</>;
    drawing.localX.set(id, x - offsetX);
    return <LayerId.Provider value={id}>{children}</LayerId.Provider>;
  }
  function Rect({ name, fill }: { name?: string; fill?: string }) {
    const id = useContext(LayerId);
    if (id && name === 'design-frame-interior' && fill) drawing.frameFills.set(id, fill);
    if (name?.startsWith('design-layout-') || name?.startsWith('design-anchor-')) drawing.handles.add(name);
    return null;
  }
  function Image(props: { image: HTMLImageElement; name?: string; crop?: Bounds }) {
    const id = useContext(LayerId);
    const stageImages = useContext(StageImages);
    if (id) {
      drawing.images.set(id, props);
      stageImages?.set(id, props.image);
    }
    return null;
  }
  function publishPaths(id: string, paths: Set<Mount>) {
    const visible = [...paths];
    const lastPath = visible.at(-1);
    const lastStroke = visible.findLast(({ strokeWidth }) => strokeWidth !== undefined)?.strokeWidth;
    if (lastPath) drawing.paths.set(id, lastPath.data);
    else drawing.paths.delete(id);
    if (lastStroke !== undefined) drawing.pathStrokeWidths.set(id, lastStroke);
    else drawing.pathStrokeWidths.delete(id);
  }
  function Path({ data, strokeWidth }: Mount) {
    const id = useContext(LayerId);
    useLayoutEffect(() => {
      if (!id) return;
      const paths = mountedPaths.get(id) ?? new Set<Mount>();
      const path = { data, strokeWidth };
      paths.add(path);
      mountedPaths.set(id, paths);
      publishPaths(id, paths);
      return () => {
        paths.delete(path);
        if (!paths.size) mountedPaths.delete(id);
        publishPaths(id, paths);
      };
    }, [id, data, strokeWidth]);
    return null;
  }
  const shape = () => null;
  return { Stage, Group, Layer: Container, Rect, Circle: shape, Ellipse: shape, Line: shape,
    Shape: shape, Path, Image, Label: Container, Tag: shape, Text: shape };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  drawing.frameFills.clear();
  drawing.localX.clear();
  drawing.images.clear();
  drawing.exportedImages.clear();
  drawing.paths.clear();
  drawing.pathStrokeWidths.clear();
  drawing.handles.clear();
  drawing.hit = undefined;
});

export async function mountEditor(source: Omit<DesignDocument, 'schemaVersion'> & { schemaVersion: number }, saveGate = Promise.resolve(), options: Readonly<{
  documentPath?: string;
  translate?: RendererTranslate;
  fonts?: DesignClient['fonts'];
  searchImages?: DesignAssets['search'];
  readImage?: DesignAssets['read'];
  importImage?: DesignClient['importImage'];
  importScript?: DesignClient['importScript'];
  readScriptParameters?: DesignClient['readScriptParameters'];
  renderScript?: DesignClient['renderScript'];
  webPreview?: DesignAssets['webPreview'];
  requestClipboardPaste?: DesignAssets['requestClipboardPaste'];
  readDesignLayers?: DesignAssets['output']['readDesignLayers'];
  output?: Partial<DesignAssets['output']>;
  libraries?: Readonly<Record<string, DesignDocument>>;
}> = {}) {
  const documentRef = { projectId: 'project', rootId: 'root', path: options.documentPath ?? 'test.design.json' };
  let content = JSON.stringify(source);
  let revision = 0;
  const replace = vi.fn(async (next: string) => {
    await saveGate;
    content = next;
    return String(++revision);
  });
  const service = new DesignDocumentService({
    create: vi.fn(),
    withDocument: (_ref, _signal, operation) => operation({ key: source.documentId,
      read: async () => ({ content, revision: String(revision) }), replace }),
  });
  const signal = new AbortController().signal;
  const commit = vi.fn<DesignClient['commit']>((input) => service.commit(commitDesignEdits.input.parse(input), signal));
  const client: DesignClient = {
    fonts: options.fonts ?? { list: vi.fn().mockResolvedValue([]), read: vi.fn(), import: vi.fn(), remove: vi.fn() },
    assets: {
      webPreview: options.webPreview,
      search: options.searchImages ?? (async () => []), read: options.readImage ?? vi.fn(), readLinkedImage: vi.fn(),
      requestClipboardPaste: options.requestClipboardPaste ?? vi.fn().mockResolvedValue({ kind: 'unavailable' }),
      output: { saveDesignHtml: vi.fn(), saveDesignSvg: vi.fn(), saveImageAs: vi.fn(), copyImageToClipboard: vi.fn(), copyDesignLayers: vi.fn(),
        readDesignLayers: options.readDesignLayers ?? vi.fn(), copyText: vi.fn(), ...options.output },
    },
    list: vi.fn().mockResolvedValue([]), create: vi.fn(), move: vi.fn(), delete: vi.fn(), importImage: options.importImage ?? vi.fn(), commit,
    importScript: options.importScript ?? vi.fn(),
    importShader: vi.fn(), readShader: vi.fn(),
    resolveResourceRoot: async (ref) => ref,
    readScriptParameters: options.readScriptParameters ?? vi.fn().mockResolvedValue([]),
    renderScript: options.renderScript ?? vi.fn(),
    read: (ref, readSignal) => {
      const library = options.libraries?.[ref.path];
      return library ? Promise.resolve({ document: library, revision: '0', canUndo: false, canRedo: false }) : service.read(ref, readSignal ?? signal);
    },
    navigate: (input) => service.navigate(input, signal),
  };
  const layoutEngine = await loadYoga();
  render(<UiProvider locale="en-US"><ToastProvider>
    <DesignEditor client={client} documentRef={documentRef} layoutEngine={layoutEngine} translate={options.translate ?? ((key) => key)} />
  </ToastProvider></UiProvider>);
  return { documentRef, commit, replace, revision: () => revision, read: () => service.read(documentRef, signal) };
}

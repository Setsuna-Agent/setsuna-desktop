import { designLibraryFileLinks, findBundledDesignLibrary, type DesignDocumentRef } from '../../contracts/index.js';
import { renderDesignThumbnail } from '../canvas/DesignThumbnail.js';
import { loadDesignLayoutEngine } from '../canvas/design-layout-engine.js';
import type { DesignClient } from '../client.js';
import { projectDesignComponents } from '../components/design-components.js';
import { buildDesignLibraryResources } from '../components/design-library-resources.js';
import { readDesignLibraryFiles } from '../components/read-design-library-files.js';
import { createDesignImageLoader, type LoadDesignImage } from '../design-images.js';
import { resolveDesignScene } from '../design-layout.js';
import { measureDesignText } from '../design-text.js';
import { designExportFontRequests } from '../export/design-export-scene.js';
import { createDesignPreviewFontLoader } from '../text/design-font-loader.js';

export async function renderDesignCatalogPreview(client: DesignClient, ref: DesignDocumentRef, signal: AbortSignal,
  previewFonts?: ReturnType<typeof createDesignPreviewFontLoader>,
) {
  const { document: authored } = await client.read(ref, signal);
  if (!authored.rootIds.length) return;
  signal.throwIfAborted();
  let resourceSource: Promise<DesignDocumentRef> | undefined;
  const resolveSource = () => resourceSource ??= client.resolveResourceRoot(ref, signal);
  const links = Object.entries(authored.libraries ?? {});
  const libraryPaths = new Set(designLibraryFileLinks(authored.libraries).map(([, path]) => path));
  let librarySource = ref;
  const libraryClient: Pick<DesignClient, 'read'> = {
    read: (target, signal) => {
      // Track attempted reads too, so a missing direct or transitive library can invalidate the thumbnail when restored.
      if (!findBundledDesignLibrary(target.path)) libraryPaths.add(target.path);
      return client.read(target, signal);
    },
  };
  const libraryFiles = links.length
    ? (libraryPaths.size ? resolveSource() : Promise.resolve(ref)).then((source) => {
      librarySource = source;
      return readDesignLibraryFiles(libraryClient, source, authored.documentId, links, signal);
    }).catch(() => undefined)
    : undefined;
  const [layout, files] = await Promise.all([loadDesignLayoutEngine(), libraryFiles]);
  signal.throwIfAborted();
  const resources = files && buildDesignLibraryResources(authored.documentId, [...files.values()].map(({ snapshot }) => snapshot.document));
  const document = projectDesignComponents(authored, resources);
  const libraries = [...libraryPaths].map((path) => ({ ...librarySource, path }));
  const visible = document.rootIds.filter((id) => !document.nodes[id].hidden);
  const board = visible.find((id) => document.nodes[id].kind === 'frame');
  const ids = board ? [board] : visible;
  if (!ids.length) return { libraries };

  let imageLoader: Promise<LoadDesignImage> | undefined;
  const loadImage: LoadDesignImage = (path) => {
    imageLoader ??= resolveSource().then((source) => createDesignImageLoader(client.assets, source));
    return imageLoader.then((load) => load(path));
  };
  const fonts = previewFonts ?? createDesignPreviewFontLoader(client.fonts);
  try {
    await fonts.load(designExportFontRequests({ document, ids }), signal);
    signal.throwIfAborted();
    const scene = resolveDesignScene(layout, document, measureDesignText, { rootIds: ids });
    const src = await renderDesignThumbnail({ document, scene, ids }, loadImage, 512, signal);
    return { src, libraries };
  } finally {
    if (!previewFonts) fonts.dispose();
  }
}

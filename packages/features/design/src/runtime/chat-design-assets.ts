import { designImageFileExtensions, type DesignDocument, type DesignDocumentRef, type DesignEdit } from '../contracts/index.js';
import { designDocumentAssetPaths, designNodeAssetPaths } from '../contracts/design-image-references.js';
import type { DesignDocumentService } from './design-document-service.js';

/** A shared storage directory can contain unrelated drafts. Its files become available
 * through this draft, an explicitly linked library, or a successful import into this canvas. */
export class ChatDesignAssets {
  constructor(private readonly ref: DesignDocumentRef, private readonly documents: Pick<DesignDocumentService, 'read' | 'withSnapshot'>) {}

  async images(document: DesignDocument, signal: AbortSignal) {
    return [...await this.paths(document, true, signal)].sort();
  }

  async check(document: DesignDocument, edits: readonly DesignEdit[], signal: AbortSignal) {
    const requested = new Set<string>();
    for (const edit of edits) {
      if (edit.kind === 'insert' || edit.kind === 'update') {
        for (const path of designNodeAssetPaths(edit.node)) requested.add(path);
      }
    }
    if (!requested.size) return;
    const available = await this.paths(document, false, signal, requested);
    for (const path of requested) if (!available.has(path)) throw new Error('Import this asset into the draft before referencing it.');
  }

  private async paths(document: DesignDocument, imagesOnly: boolean, signal: AbortSignal, needed?: ReadonlySet<string>) {
    const paths = new Set(designDocumentAssetPaths(document, imagesOnly));
    const seen = new Set([document.documentId]);
    const links = Object.entries(document.libraries ?? {});
    for (let i = 0; i < links.length; i++) {
      if (needed && [...needed].every((path) => paths.has(path))) break;
      signal.throwIfAborted();
      const [id, path] = links[i];
      if (seen.has(id)) continue;
      const library = await this.documents.read({ ...this.ref, path }, signal).catch(() => undefined);
      signal.throwIfAborted();
      if (library?.document.documentId !== id) continue;
      seen.add(id);
      for (const asset of designDocumentAssetPaths(library.document, imagesOnly)) paths.add(asset);
      links.push(...Object.entries(library.document.libraries ?? {}));
    }
    if (!needed || [...needed].some((path) => !paths.has(path))) {
      const imported = await this.documents.withSnapshot(this.ref, signal, ({ document: current }, file) => {
        if (current.documentId !== document.documentId) throw new Error('Design document changed.');
        return file.importedAssets?.(current.documentId, (path) => !paths.has(path) && (!needed || needed.has(path))
          && (!imagesOnly || designImageFileExtensions.some((extension) => path.endsWith('.' + extension)))) ?? [];
      });
      for (const path of imported) paths.add(path);
    }
    return paths;
  }
}

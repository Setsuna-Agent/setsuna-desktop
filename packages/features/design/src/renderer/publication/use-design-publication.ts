import { useContext, useEffect, useRef, useState } from 'react';
import { isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import type { Yoga } from 'yoga-layout/load';
import type { DesignDocumentRef, DesignSnapshot } from '../../contracts/operations.js';
import type { DesignPreviewAccess, DesignPublicationBridge } from '../../contracts/design-publication.js';
import type { DesignClient } from '../client.js';
import { DesignExportPreviewContext } from '../export/DesignExportPreviewProvider.js';
import type { DesignExportRequest } from '../export/use-design-exports.js';

export type DesignPublicationSource = Readonly<{
  client: DesignClient;
  documentRef: DesignDocumentRef;
  documentId: string;
  layout: Yoga;
  synchronize(signal: AbortSignal): Promise<DesignSnapshot>;
  exportDocument?(request: DesignExportRequest): void;
}>;

type JobKind = 'package' | 'preview';

export function useDesignPublication(source: DesignPublicationSource, bridge: DesignPublicationBridge, t: RendererTranslate) {
  const [job, setJob] = useState<JobKind>();
  const current = useRef<{ kind: JobKind; controller: AbortController }>();
  const toast = useToast();
  const presentExport = useContext(DesignExportPreviewContext);
  useEffect(() => () => {
    current.current?.controller.abort();
    current.current = undefined;
  }, []);

  async function savedSnapshot(signal: AbortSignal) {
    const snapshot = await source.synchronize(signal);
    signal.throwIfAborted();
    if (snapshot.document.documentId !== source.documentId) throw new Error(t('feature.design.publication.changed'));
    return snapshot;
  }

  async function run<T>(kind: JobKind, action: (signal: AbortSignal) => Promise<T>) {
    if (current.current) return;
    const work = { kind, controller: new AbortController() };
    current.current = work;
    const { signal } = work.controller;
    setJob(kind);
    try {
      const result = await action(signal);
      if (!signal.aborted) return result;
    } catch (error) {
      if (!signal.aborted && !isFeatureOperationCancelled(error)) {
        toast.error(t(kind === 'package' ? 'feature.design.publication.exportFailed' : 'feature.design.publication.publishFailed',
          { error: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      if (current.current === work) {
        current.current = undefined;
        setJob(undefined);
      }
    }
  }

  const exportPackage = () => run('package', async (signal) => {
    if (!presentExport) throw new Error(t('feature.design.exportPreview.unavailable'));
    return presentExport(async (previewSignal) => {
      const { document, revision } = await savedSnapshot(previewSignal);
      return { kind: 'zip', version: { ref: source.documentRef, documentId: document.documentId, expectedRevision: revision } };
    }, signal);
  });

  const publish = (access: DesignPreviewAccess) => run('preview', async (signal) => {
    const snapshot = await savedSnapshot(signal);
    const { publishDesignPreview } = await import('./publish-design-preview.js');
    signal.throwIfAborted();
    return publishDesignPreview(source.client, bridge, source.documentRef, snapshot, source.layout, access, signal, t);
  });

  return { job, exportPackage, publish, cancel(kind: JobKind) {
    if (current.current?.kind === kind) current.current.controller.abort();
  } };
}

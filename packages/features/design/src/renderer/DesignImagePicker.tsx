import { ImageIcon, ImageOff, Search, Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dialog, TextField, useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignDocumentRef } from '../contracts/index.js';
import type { DesignAssets, DesignClient } from './client.js';
import { DesignImageGallery, useProjectImagePreview } from './DesignImageGallery.js';
import {
  clipboardDesignImage, designImageAccept, isDesignImageName, prepareLocalDesignImage, storePreparedDesignImage,
  type LoadDesignImage, type PreparedDesignImage,
} from './design-images.js';
import './design-image-picker.css';

type ImageChoice = Readonly<
  { kind: 'project'; path: string } | { kind: 'local'; image: PreparedDesignImage; storedPath?: string }
>;
type PickerOperation = 'preview' | 'insert';
const emptyPaths: readonly string[] = [];

export function DesignImagePicker({ documentRef, assets, loadImage, currentPath, replacing = false, translate: t, onClose, onImport, onInsert }: Readonly<{
  documentRef: DesignDocumentRef;
  assets: DesignAssets;
  loadImage: LoadDesignImage;
  currentPath?: string;
  replacing?: boolean;
  translate: RendererTranslate;
  onClose(): void;
  onImport: DesignClient['importImage'];
  onInsert(path: string): Promise<boolean>;
}>) {
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{ query: string; paths: readonly string[] }>();
  const [choice, setChoice] = useState<ImageChoice | undefined>(() => currentPath ? { kind: 'project', path: currentPath } : undefined);
  const [pending, setPending] = useState<PickerOperation>();
  const operation = useRef<AbortController>();
  const input = useRef<HTMLInputElement>(null);
  const formId = useId();
  const toast = useToast();
  const searchValue = query.trim();

  useEffect(() => () => operation.current?.abort(), []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void assets.search(documentRef, searchValue).then((paths) => {
        if (active) setSearchResult({ query: searchValue, paths });
      }).catch(() => {
        if (!active) return;
        setSearchResult({ query: searchValue, paths: emptyPaths });
        toast.error(t('feature.design.searchImagesFailed'));
      });
    }, searchValue ? 180 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [assets, searchValue, documentRef, t, toast]);

  const searching = searchResult?.query !== searchValue;
  const paths = searching ? emptyPaths : searchResult.paths;
  const local = choice?.kind === 'local' ? choice : undefined;
  const defaultPath = paths.find((path) => path === searchValue) ?? paths[0]
    ?? (!searching && isDesignImageName(searchValue) ? searchValue : undefined);
  const projectPath = choice?.kind === 'project' ? choice.path : local ? undefined : defaultPath;
  const projectPreview = useProjectImagePreview(projectPath, loadImage);
  const src = local?.image.src ?? projectPreview;
  const caption = local?.image.name ?? projectPath;
  const loadingPreview = pending === 'preview' || Boolean(projectPath && projectPreview === undefined);
  const canInsert = Boolean(src && !pending && (local || projectPath !== currentPath));
  const previewError = projectPreview === null && projectPath ? t('feature.design.loadImageFailed', { path: projectPath }) : undefined;
  const title = t(replacing ? 'feature.design.replaceImage' : 'feature.design.addImage');

  async function run(phase: PickerOperation, task: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    operation.current = controller;
    setPending(phase);
    try {
      await task(signal);
    } catch (error) {
      if (!signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      operation.current = undefined;
      if (!signal.aborted) setPending(undefined);
    }
  }

  function previewLocalFile(file: File) {
    void run('preview', async (signal) => {
      const image = await prepareLocalDesignImage(file, signal, t);
      if (!signal.aborted) setChoice({ kind: 'local', image });
    });
  }

  function confirmImage() {
    if (!canInsert) return;
    void run('insert', async (signal) => {
      let path = local?.storedPath ?? projectPath;
      if (local && !path) {
        path = await storePreparedDesignImage(local.image, { ref: documentRef, store: onImport, signal, translate: t });
        // Retrying a failed layer edit can reuse the stored asset and keep the preview.
        if (!signal.aborted) setChoice({ ...local, storedPath: path });
      }
      if (!path || signal.aborted) return;
      try {
        const inserted = await onInsert(path);
        if (inserted && !signal.aborted) onClose();
      } catch (error) {
        throw new Error(t('feature.design.loadImageFailed', { path }), { cause: error });
      }
    });
  }

  return <Dialog className="design-image-picker-dialog" title={title} width={720} dismissible={pending !== 'insert'} onClose={onClose}
    footer={<>
      <Button variant="secondary" icon={<Upload size={16} />} loading={pending === 'preview'}
        disabled={Boolean(pending)} onClick={() => input.current?.click()}>{t('feature.design.importLocalImage')}</Button>
      <Button type="submit" form={formId} variant="primary" loading={pending === 'insert'} disabled={!canInsert}>
        {t(replacing ? 'feature.design.replaceImage' : 'feature.design.insert')}
      </Button>
    </>}
    onPaste={(event) => {
      if (event.defaultPrevented) return;
      const image = clipboardDesignImage(event.clipboardData);
      if (!image) return;
      event.preventDefault();
      previewLocalFile(image);
    }}>
    <form id={formId} className="design-image-picker" onSubmit={(event) => { event.preventDefault(); confirmImage(); }}>
      <div className="design-image-picker__content">
        <div className="design-image-picker__browser">
          <TextField autoFocus appearance="search" aria-label={t('feature.design.imagePath')} placeholder={t('feature.design.imagePath')}
            leadingIcon={<Search size={16} />} readOnly={Boolean(pending)} value={query} onChange={(event) => {
              setQuery(event.target.value);
              setChoice((current) => current?.kind === 'local' ? current : undefined);
            }} />
          <DesignImageGallery paths={paths} loadImage={loadImage} selected={projectPath} searching={searching}
            label={t('feature.design.image')} disabled={Boolean(pending)}
            onSelect={(path) => setChoice({ kind: 'project', path })} />
        </div>
        <figure className="design-image-picker__preview">
          <div className="design-image-picker__stage" aria-busy={loadingPreview}>
            {src ? <img src={src} alt="" draggable={false} />
              : loadingPreview ? <span className="sd-spinner" aria-hidden="true" />
                : previewError ? <span className="design-image-picker__placeholder" role="img" aria-label={previewError} title={previewError}>
                  <ImageOff size={26} strokeWidth={1.5} />
                </span> : <span className="design-image-picker__placeholder" aria-hidden="true"><ImageIcon size={28} strokeWidth={1.5} /></span>}
          </div>
          {caption ? <figcaption className="design-image-picker__caption" title={caption}>{caption}</figcaption> : null}
        </figure>
      </div>
      <input ref={input} type="file" accept={designImageAccept} hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) previewLocalFile(file);
      }} />
    </form>
  </Dialog>;
}

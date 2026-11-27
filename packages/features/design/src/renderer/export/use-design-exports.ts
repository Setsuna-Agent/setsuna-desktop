import { useContext, useEffect, useRef, useState } from 'react';
import { isValidWorkspaceEntryName } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignLayerExport } from '../../contracts/design-export.js';
import type { CaptureDesignWebImages } from '../canvas/use-design-web-previews.js';
import type { DesignAssets } from '../client.js';
import type { LoadDesignImage } from '../design-images.js';
import { DesignShaderAssetsContext } from '../shaders/use-design-shader-assets.js';
import { DesignFontsContext } from '../text/use-design-fonts.js';
import { designExportBounds, designExportFontRequests, designExportShaderPaths,
  loadExportImages, loadExportWebImages, type DesignExportSelection } from './design-export-scene.js';
import type { DesignCodeFormat } from './export-design-html.js';
import { DesignExportPreviewContext } from './DesignExportPreviewProvider.js';
import { copyDesignLayerExport, saveDesignLayerExport } from './design-layer-export-actions.js';

export type DesignPngScale = 1 | 2 | 3;
export type DesignExportRequest =
  | { kind: 'code'; format: DesignCodeFormat; action: 'copy' | 'save' }
  | { kind: 'svg'; action: 'save' }
  | { kind: 'image'; scale: DesignPngScale; action: 'copy' | 'save' };

export function useDesignExports(output: DesignAssets['output'], loadImage: LoadDesignImage, t: RendererTranslate,
  captureWebImages: CaptureDesignWebImages,
) {
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController>();
  useEffect(() => () => pending.current?.abort(), []);
  const toast = useToast();
  const present = useContext(DesignExportPreviewContext);
  const fonts = useContext(DesignFontsContext);
  const shaderAssets = useContext(DesignShaderAssetsContext);

  async function prepare(selection: DesignExportSelection, signal: AbortSignal, includeFonts: boolean) {
    const paths = designExportShaderPaths(selection);
    const shaders = paths.length && shaderAssets
      ? Promise.all(paths.map(async (path) => [path, await shaderAssets.read(path, signal)] as const)) : undefined;
    const [images, webImages, shaderEntries, fontCss] = await Promise.all([
      loadExportImages(selection, loadImage), loadExportWebImages(selection, captureWebImages, signal, t),
      shaders, !includeFonts ? undefined : fonts?.css(designExportFontRequests(selection)),
    ]);
    signal.throwIfAborted();
    const sources = shaderEntries && new Map(shaderEntries);
    const captured = { ...selection, webImages };
    return { captured, images, sources, fontCss };
  }

  async function preview(selection: DesignExportSelection, signal: AbortSignal) {
    const bounds = designExportBounds(selection);
    if (!bounds || fonts?.loading) throw new Error('The selection is not ready to render.');
    const { captured, images, sources } = await prepare(selection, signal, false);
    const { renderDesignPng } = await import('./export-design-png.js');
    signal.throwIfAborted();
    const ratio = Math.min(1, 1024 / Math.max(1, bounds.width, bounds.height));
    return { image: renderDesignPng(captured, bounds, images, ratio, sources), bounds };
  }

  async function generate(selection: DesignExportSelection, name: string, request: DesignExportRequest, signal: AbortSignal): Promise<DesignLayerExport> {
    signal.throwIfAborted();
    if (fonts?.loading) throw new Error('Fonts are loading.');
    const bounds = designExportBounds(selection);
    if (!bounds) throw new Error('No visible design layers to export.');
    const { captured, images, sources, fontCss } = await prepare(selection, signal, request.kind !== 'image');
    if (request.kind === 'image') {
      const { renderDesignExportPng } = await import('./export-design-png.js');
      const { dataUrl, scale, width, height } = await renderDesignExportPng(captured, bounds, images, request.scale, signal, sources);
      const suffix = scale < request.scale ? `-${width}x${height}` : request.scale === 1 ? '' : `@${request.scale}x`;
      return { kind: 'png', name: exportFileName(name, `${suffix}.png`), content: dataUrl };
    }
    const baked = sources ? await (await import('./export-design-png.js')).bakeDesignShaderFills(captured, bounds, images, sources) : { selection: captured, images };
    if (request.kind === 'svg') {
      const { renderDesignSvg } = await import('./export-design-svg.js');
      signal.throwIfAborted();
      return { kind: 'svg', name: exportFileName(name, '.svg'), content: renderDesignSvg(baked.selection, bounds, baked.images, name, fontCss) };
    }
    const { renderDesignHtml } = await import('./export-design-html.js');
    signal.throwIfAborted();
    return { kind: 'html', name: exportFileName(name, '.html'),
      content: renderDesignHtml(baked.selection, bounds, baked.images, name, request.format, fontCss, request.action === 'save' ? t : undefined) };
  }

  async function deliver(selection: DesignExportSelection, name: string, request: DesignExportRequest, signal: AbortSignal) {
    if (request.action === 'save' && present) return present((previewSignal) => generate(selection, name, request, previewSignal), signal);
    const file = await generate(selection, name, request, signal);
    signal.throwIfAborted();
    return request.action === 'copy' ? copyDesignLayerExport(output, file) : saveDesignLayerExport(output, file);
  }

  async function run(selection: DesignExportSelection, name: string, request: DesignExportRequest) {
    if (pending.current || fonts?.loading || !selection.ids.length) return;
    const controller = new AbortController();
    const { signal } = controller;
    pending.current = controller;
    setBusy(true);
    try {
      if (!await deliver(selection, name, request, signal)) return;
      if (!signal.aborted && (request.action === 'copy' || !present)) {
        toast.success(t(request.action === 'copy' ? 'feature.design.copied' : 'feature.design.exportSaved'));
      }
    } catch (error) {
      if (!signal.aborted) toast.error(t('feature.design.exportFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      pending.current = undefined;
      if (!signal.aborted) setBusy(false);
      controller.abort();
    }
  }
  return { busy: busy || Boolean(fonts?.loading), run, preview, deliver };
}

function exportFileName(name: string, suffix: string): string {
  const safeName = name.replace(/[<>:"/\\|?*]/gu, '-').replace(/[\p{Cc}]/gu, '-');
  const base = [...safeName].slice(0, 56).join('').trim().replace(/\.+$/u, '');
  if (!base) return `design${suffix}`;
  return isValidWorkspaceEntryName(`${base}${suffix}`) ? `${base}${suffix}` : `design-${base}${suffix}`;
}

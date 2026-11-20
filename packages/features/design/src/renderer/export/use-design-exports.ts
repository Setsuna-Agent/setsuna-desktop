import { useContext, useEffect, useRef, useState } from 'react';
import { isValidWorkspaceEntryName } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import type { CaptureDesignWebImages } from '../canvas/use-design-web-previews.js';
import type { DesignAssets } from '../client.js';
import type { LoadDesignImage } from '../design-images.js';
import { DesignShaderAssetsContext } from '../shaders/use-design-shader-assets.js';
import { DesignFontsContext } from '../text/use-design-fonts.js';
import { designExportBounds, designExportFontRequests, designExportShaderPaths,
  loadExportImages, loadExportWebImages, type DesignExportSelection } from './design-export-scene.js';
import type { DesignCodeFormat } from './export-design-html.js';

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
  const fonts = useContext(DesignFontsContext);
  const shaderAssets = useContext(DesignShaderAssetsContext);

  async function run(selection: DesignExportSelection, name: string, request: DesignExportRequest) {
    if (pending.current || fonts?.loading || !selection.ids.length) return;
    const controller = new AbortController();
    const { signal } = controller;
    pending.current = controller;
    setBusy(true);
    try {
      const bounds = designExportBounds(selection);
      if (!bounds) return;
      if (request.kind === 'image') {
        const width = Math.ceil(bounds.width) * request.scale;
        const height = Math.ceil(bounds.height) * request.scale;
        if (width < 1 || height < 1 || Math.max(width, height) > 32_767 || width * height > 16_000_000) {
          throw new Error(t('feature.design.imageExportTooLarge'));
        }
      }
      const paths = designExportShaderPaths(selection);
      const shaders = paths.length && shaderAssets
        ? Promise.all(paths.map(async (path) => [path, await shaderAssets.read(path, signal)] as const)) : undefined;
      const [images, webImages, shaderEntries, fontCss] = await Promise.all([
        loadExportImages(selection, loadImage), loadExportWebImages(selection, captureWebImages, signal, t),
        shaders, request.kind === 'image' ? undefined : fonts?.css(designExportFontRequests(selection)),
      ]);
      signal.throwIfAborted();
      const sources = shaderEntries && new Map(shaderEntries);
      const captured = { ...selection, webImages };
      if (request.kind === 'image') {
        const { renderDesignPng } = await import('./export-design-png.js');
        signal.throwIfAborted();
        const dataUrl = renderDesignPng(captured, bounds, images, request.scale, sources);
        const suffix = request.scale === 1 ? '' : `@${request.scale}x`;
        const input = { name: exportFileName(name, `${suffix}.png`), dataUrl };
        const result = await (request.action === 'copy' ? output.copyImageToClipboard(input) : output.saveImageAs(input));
        if (!result.ok) throw new Error(result.error);
        if (result.cancelled) return;
      } else {
        const baked = sources ? await (await import('./export-design-png.js')).bakeDesignShaderFills(captured, bounds, images, sources) : { selection: captured, images };
        if (request.kind === 'svg') {
          const { renderDesignSvg } = await import('./export-design-svg.js');
          signal.throwIfAborted();
          const svg = renderDesignSvg(baked.selection, bounds, baked.images, name, fontCss);
          const result = await output.saveDesignSvg({ name: exportFileName(name, '.svg'), svg });
          if (!result.ok) throw new Error(result.error);
          if (result.cancelled) return;
        } else {
          const { renderDesignHtml } = await import('./export-design-html.js');
          signal.throwIfAborted();
          const html = renderDesignHtml(baked.selection, bounds, baked.images, name, request.format, fontCss);
          if (request.action === 'copy') await output.copyText(html);
          else {
            const result = await output.saveDesignHtml({ name: exportFileName(name, '.html'), html });
            if (!result.ok) throw new Error(result.error);
            if (result.cancelled) return;
          }
        }
      }
      if (!signal.aborted) toast.success(t(request.action === 'copy' ? 'feature.design.copied' : 'feature.design.exportSaved'));
    } catch (error) {
      if (!signal.aborted) toast.error(t('feature.design.exportFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      pending.current = undefined;
      if (!signal.aborted) setBusy(false);
      controller.abort();
    }
  }
  return { busy: busy || Boolean(fonts?.loading), run };
}

function exportFileName(name: string, suffix: string): string {
  const safeName = name.replace(/[<>:"/\\|?*]/gu, '-').replace(/[\p{Cc}]/gu, '-');
  const base = [...safeName].slice(0, 56).join('').trim().replace(/\.+$/u, '');
  if (!base) return `design${suffix}`;
  return isValidWorkspaceEntryName(`${base}${suffix}`) ? `${base}${suffix}` : `design-${base}${suffix}`;
}

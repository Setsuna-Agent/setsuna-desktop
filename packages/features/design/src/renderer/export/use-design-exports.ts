import { useRef, useState } from 'react';
import { isValidWorkspaceEntryName } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignAssets } from '../client.js';
import type { LoadDesignImage } from '../design-images.js';
import { designExportBounds, loadExportImages, type DesignExportSelection } from './design-export-scene.js';
import type { DesignCodeFormat } from './export-design-html.js';

export type DesignPngScale = 1 | 2 | 3;
export type DesignExportRequest =
  | { kind: 'code'; format: DesignCodeFormat; action: 'copy' | 'save' }
  | { kind: 'svg'; action: 'save' }
  | { kind: 'image'; scale: DesignPngScale; action: 'copy' | 'save' };

export function useDesignExports(output: DesignAssets['output'], loadImage: LoadDesignImage, t: RendererTranslate) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const toast = useToast();

  async function run(selection: DesignExportSelection, name: string, request: DesignExportRequest) {
    if (pending.current || !selection.ids.length) return;
    pending.current = true;
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
        const [{ renderDesignPng }, images] = await Promise.all([
          import('./export-design-png.js'), loadExportImages(selection, loadImage),
        ]);
        const dataUrl = renderDesignPng(selection, bounds, images, request.scale);
        const suffix = request.scale === 1 ? '' : `@${request.scale}x`;
        const input = { name: exportFileName(name, `${suffix}.png`), dataUrl };
        const result = await (request.action === 'copy' ? output.copyImageToClipboard(input) : output.saveImageAs(input));
        if (!result.ok) throw new Error(result.error);
        if (result.cancelled) return;
      } else if (request.kind === 'svg') {
        const [{ renderDesignSvg }, images] = await Promise.all([
          import('./export-design-svg.js'), loadExportImages(selection, loadImage),
        ]);
        const svg = renderDesignSvg(selection, bounds, images, name);
        const result = await output.saveDesignSvg({ name: exportFileName(name, '.svg'), svg });
        if (!result.ok) throw new Error(result.error);
        if (result.cancelled) return;
      } else {
        const [{ renderDesignHtml }, images] = await Promise.all([
          import('./export-design-html.js'), loadExportImages(selection, loadImage),
        ]);
        const html = renderDesignHtml(selection, bounds, images, name, request.format);
        if (request.action === 'copy') await output.copyText(html);
        else {
          const result = await output.saveDesignHtml({ name: exportFileName(name, '.html'), html });
          if (!result.ok) throw new Error(result.error);
          if (result.cancelled) return;
        }
      }
      toast.success(t(request.action === 'copy' ? 'feature.design.copied' : 'feature.design.exportSaved'));
    } catch (error) {
      toast.error(t('feature.design.exportFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { busy, run };
}

function exportFileName(name: string, suffix: string): string {
  const safeName = name.replace(/[<>:"/\\|?*]/gu, '-').replace(/[\p{Cc}]/gu, '-');
  const base = [...safeName].slice(0, 56).join('').trim().replace(/\.+$/u, '');
  if (!base) return `design${suffix}`;
  return isValidWorkspaceEntryName(`${base}${suffix}`) ? `${base}${suffix}` : `design-${base}${suffix}`;
}

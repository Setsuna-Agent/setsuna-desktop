import {
  MAX_WORKSPACE_IMAGE_BYTES, workspaceTarget, type DesktopRuntimeClient, type DesktopWorkspaceEntriesWatchOptions, type SetsunaDesktopBridge,
} from '@setsuna-desktop/contracts';
import { designImageFileExtensions } from '@setsuna-desktop/feature-design/contracts';
import type { DesignAssets } from '@setsuna-desktop/feature-design/renderer';
import { copyTextToClipboard } from '../../shared/lib/clipboard.js';

export function watchDesignDirectories(
  root: string, directories: readonly string[], changed: () => void, options?: DesktopWorkspaceEntriesWatchOptions,
): () => void {
  return window.setsunaDesktop?.desktop?.watchWorkspaceEntries?.(root, [...directories], changed, options) ?? (() => undefined);
}

export function createDesignAssets(
  runtime: Pick<DesktopRuntimeClient, 'readProjectFile' | 'searchProjectEntries'>,
  desktop: Omit<DesignAssets['output'], 'copyText'> & Partial<Pick<SetsunaDesktopBridge['desktop'], 'pasteDesign'>>,
  pasteByWindowControls: () => Promise<boolean>,
): DesignAssets {
  return {
    async requestClipboardPaste(acceptSvg) {
      if (desktop.pasteDesign) return desktop.pasteDesign(acceptSvg);
      // A renderer can reload while development is still using the previous preload.
      return { kind: await pasteByWindowControls() ? 'issued' : 'unavailable' };
    },
    async search({ projectId, rootId }, query) {
      const { entries } = await runtime.searchProjectEntries(workspaceTarget(projectId, rootId), query, null,
        { fileExtensions: designImageFileExtensions });
      return entries.map(({ path }) => path);
    },
    async read({ projectId, rootId }, path) {
      const { preview } = await runtime.readProjectFile(workspaceTarget(projectId, rootId), path);
      return preview?.kind === 'image' ? preview : null;
    },
    readLinkedImage,
    output: {
      saveDesignHtml: (input) => desktop.saveDesignHtml(input),
      saveDesignSvg: (input) => desktop.saveDesignSvg(input),
      saveImageAs: (input) => desktop.saveImageAs(input),
      copyImageToClipboard: (input) => desktop.copyImageToClipboard(input),
      copyDesignLayers: (content) => desktop.copyDesignLayers(content),
      readDesignLayers: () => desktop.readDesignLayers(),
      copyText: copyTextToClipboard,
    },
  };
}

async function readLinkedImage(source: string, signal: AbortSignal): Promise<File> {
  const url = new URL(source);
  // Browser CORS still applies. Import a local copy without forwarding the app's credentials or following redirects.
  if (url.protocol !== 'https:' || url.username || url.password || url.port || /(?:^|\.)(?:localhost|local)\.?$/iu.test(url.hostname)
    || !url.hostname.includes('.') || /^[\d.]+$/u.test(url.hostname)) throw new Error('Invalid image link.');
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (!response.ok || !response.body) throw new Error('Could not download the image.');
  const reader = response.body.getReader();
  const parts: BlobPart[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WORKSPACE_IMAGE_BYTES) throw new Error('The image is too large.');
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new File(parts, url.pathname.split('/').at(-1) || 'image');
}

import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { nativeImage, type Extension } from 'electron';
import type { BrowserExtension } from '../../contracts/extensions.js';
import { localizedExtensionName, localizedExtensionText } from './localization.js';

export function validExtensionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-p]{32}$/.test(value);
}

export function extensionPageUrl(extension: Extension, view: 'popup' | 'options' | 'newtab' | 'sidepanel'): string | null {
  const manifest = extension.manifest;
  const page = view === 'sidepanel' ? manifest.side_panel?.default_path : view === 'newtab' ? manifest.chrome_url_overrides?.newtab : view === 'popup'
    ? (manifest.action ?? manifest.browser_action ?? manifest.page_action)?.default_popup
    : manifest.options_ui?.page ?? manifest.options_page;
  return resolveExtensionPage(extension.id, page);
}

export function resolveExtensionPage(id: string, page: unknown): string | null {
  if (typeof page !== 'string' || !page || !validExtensionId(id)) return null;
  try {
    const base = `chrome-extension://${id}/`;
    const url = new URL(page, base);
    return url.protocol === 'chrome-extension:' && url.host === id && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

export async function extensionMetadata(extension: Extension, enabled = true, locale = '', allowUserScripts = false): Promise<BrowserExtension> {
  const action = extension.manifest.action ?? extension.manifest.browser_action ?? extension.manifest.page_action;
  const [icon, actionIcon, name, description] = await Promise.all([
    extensionIcon(extension, extension.manifest.icons), extensionIcon(extension, action?.default_icon),
    localizedExtensionName(extension, locale),
    localizedExtensionText(extension, extension.manifest.description ?? '', locale),
  ]);
  return {
    id: extension.id, name, version: extension.version, enabled,
    description, permissions: extension.manifest.permissions ?? [], hostPermissions: extension.manifest.host_permissions ?? [],
    supportsUserScripts: extension.manifest.permissions?.includes('userScripts') ?? false, allowUserScripts,
    icon, actionIcon: actionIcon ?? icon,
    hasPopup: Boolean(extensionPageUrl(extension, 'popup')),
    hasOptions: Boolean(extensionPageUrl(extension, 'options')),
    hasAction: Boolean(action),
    hasSidePanel: Boolean(extensionPageUrl(extension, 'sidepanel')),
    newTabUrl: extensionPageUrl(extension, 'newtab'),
  };
}

/** The installation directory survives restarts and updates, unlike native load order. */
export async function newestNewTabExtension(extensions: readonly Extension[]): Promise<string | null> {
  const candidates = await Promise.all(extensions.filter((extension) => extensionPageUrl(extension, 'newtab')).map(async (extension) => {
    const installed = await stat(path.dirname(extension.path)).catch(() => null);
    return { id: extension.id, installedAt: installed?.birthtimeMs || installed?.mtimeMs || 0 };
  }));
  candidates.sort((a, b) => b.installedAt - a.installedAt || a.id.localeCompare(b.id));
  return candidates[0]?.id ?? null;
}

export async function extensionIcon(extension: Extension, icons: unknown): Promise<string | null> {
  const iconPath = typeof icons === 'string' ? icons : icons && typeof icons === 'object'
    ? Object.entries(icons).filter(([size, value]) => Number(size) > 0 && typeof value === 'string')
      .sort(([left], [right]) => Math.abs(Number(left) - 32) - Math.abs(Number(right) - 32))[0]?.[1] : null;
  if (typeof iconPath !== 'string' || !iconPath) return null;
  try {
    const root = await realpath(extension.path);
    const url = /^[a-z][a-z\d+.-]*:/i.test(iconPath) ? resolveExtensionPage(extension.id, iconPath) : null;
    if (/^[a-z][a-z\d+.-]*:/i.test(iconPath) && !url) return null;
    const file = await realpath(path.resolve(root, url ? `.${decodeURIComponent(new URL(url).pathname)}` : iconPath));
    const relative = path.relative(root, file);
    // Manifests are untrusted: neither traversal nor symlinks may read host files.
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null;
    if ((await stat(file)).size > 256 * 1024) return null;
    const icon = nativeImage.createFromBuffer(await readFile(file));
    return icon.isEmpty() ? null : icon.resize({ width: 32, height: 32 }).toDataURL();
  } catch { return null; }
}

import { isRuntimePluginIconDataUrl, type RuntimePluginIconImage } from '@setsuna-desktop/contracts';
import { readFile, stat } from 'node:fs/promises';
import { detectSafeImageMimeType } from '../../utils/safe-image.js';
import { safeExistingPath } from './file-plugin-bundle-paths.js';

const MAX_ICON_BYTES = 96 * 1024;

export async function readCodexPluginIcon(root: string, presentation: Record<string, unknown>): Promise<RuntimePluginIconImage | undefined> {
  const [logo, dark, composer] = await Promise.all([
    readIcon(root, presentation.logo), readIcon(root, presentation.logoDark), readIcon(root, presentation.composerIcon),
  ]);
  const light = logo ?? composer ?? dark;
  return light ? { light, ...(dark && dark !== light ? { dark } : {}) } : undefined;
}

export function normalizePluginIconImage(value: unknown): RuntimePluginIconImage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const icon = value as Record<string, unknown>;
  if (!isRuntimePluginIconDataUrl(icon.light)) return undefined;
  return { light: icon.light, ...(isRuntimePluginIconDataUrl(icon.dark) ? { dark: icon.dark } : {}) };
}

async function readIcon(root: string, relativePath: unknown): Promise<string | undefined> {
  if (typeof relativePath !== 'string') return undefined;
  try {
    const file = await safeExistingPath(root, relativePath);
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_ICON_BYTES) return undefined;
    const bytes = await readFile(file);
    if (!bytes.length || bytes.length > MAX_ICON_BYTES) return undefined;
    const mime = detectSafeImageMimeType(bytes) ?? (isSvgImage(bytes) ? 'image/svg+xml' : undefined);
    return mime ? `data:${mime};base64,${bytes.toString('base64')}` : undefined;
  } catch {
    // Missing/unsupported artwork must not make an otherwise usable plugin unavailable.
    return undefined;
  }
}

function isSvgImage(bytes: Buffer): boolean {
  // This recognizes the format; the security boundary is SVG's image mode in
  // <img>, which disables scripts, interaction and external resource loading.
  const text = bytes.toString('utf8');
  let cursor = 0;
  while (cursor < text.length) {
    if (/\s/u.test(text[cursor])) { cursor += 1; continue; }
    const closing = text.startsWith('<?xml', cursor) ? '?>' : text.startsWith('<!--', cursor) ? '-->' : undefined;
    if (!closing) return text.startsWith('<svg', cursor) && /[\s>]/u.test(text[cursor + 4] ?? '');
    // Consume each prolog/comment exactly once, including malformed artwork.
    const end = text.indexOf(closing, cursor + (closing === '?>' ? 5 : 4));
    if (end < 0) return false;
    cursor = end + closing.length;
  }
  return false;
}

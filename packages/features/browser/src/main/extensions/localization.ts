import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Extension } from 'electron';

const messageReference = /__MSG_([\w@]+?)__/gi;

/** Disabled extensions need the same manifest-name lookup that Chromium performs when loading. */
export async function localizedExtensionName(extension: Pick<Extension, 'id' | 'name' | 'path' | 'manifest'>, locale = ''): Promise<string> {
  const shortName = extension.manifest.short_name;
  const fallback = typeof shortName === 'string' && shortName && !shortName.match(messageReference) ? shortName : extension.id;
  return localizedExtensionText(extension, extension.name, locale, fallback);
}

export async function localizedExtensionText(extension: Pick<Extension, 'path' | 'manifest'>, text: string, locale = '', fallback = ''): Promise<string> {
  if (!text.match(messageReference)) return text;
  const preferred = locale.replaceAll('-', '_');
  const candidates = [...new Set([preferred, preferred.split('_')[0], extension.manifest.default_locale])]
    .filter((value): value is string => typeof value === 'string' && /^[a-z]{2,3}(?:_[a-z\d]{2,4})?$/i.test(value));
  const messages = new Map<string, string>();
  const root = await realpath(extension.path).catch(() => null);
  if (root) {
    for (const candidate of candidates) {
      const catalog = await readMessages(root, candidate);
      for (const [key, entry] of Object.entries(catalog)) {
        if (entry && typeof entry === 'object' && 'message' in entry && typeof entry.message === 'string'
          && !messages.has(key.toLowerCase())) messages.set(key.toLowerCase(), entry.message);
      }
      const name = text.replace(messageReference, (reference, key: string) => messages.get(key.toLowerCase()) ?? reference);
      if (!name.match(messageReference)) return name;
    }
  }
  // A missing or damaged catalog must not expose manifest placeholders as a name.
  return fallback;
}

async function readMessages(root: string, locale: string): Promise<Record<string, unknown>> {
  try {
    const file = await realpath(path.join(root, '_locales', locale, 'messages.json'));
    const relative = path.relative(root, file);
    // Locale resources are extension-owned; symlinks cannot expose host files.
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return {};
    const info = await stat(file);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) return {};
    const value: unknown = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

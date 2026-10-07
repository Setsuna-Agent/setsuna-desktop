import type { BrowserImportProfile, BrowserImportPreview, BrowserExtensionImportResult } from '../../contracts/import.js';
import type { BrowserExtensionService } from '../extensions/service.js';
import { localizedExtensionName } from '../extensions/localization.js';
import { readInstalledExtensions } from '../extensions/installations.js';
import { validExtensionId } from '../extensions/metadata.js';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { isRecord, readProfileJson, withinDirectory } from './files.js';
import { readProfileBookmarks } from './bookmarks.js';
import { discoverBrowserProfiles, validateBrowserProfile, type BrowserProfileRoot, type NativeBrowserProfile } from './profiles.js';

export class BrowserImportService {
  private readonly profiles = new Map<string, NativeBrowserProfile>();

  constructor(private readonly roots: readonly BrowserProfileRoot[], private readonly extensions: Pick<BrowserExtensionService, 'list' | 'importInstallation'>,
    private readonly locale: () => string) {}

  async listProfiles(): Promise<BrowserImportProfile[]> {
    const profiles = await discoverBrowserProfiles(this.roots);
    this.profiles.clear();
    for (const profile of profiles) this.profiles.set(profile.id, profile);
    return profiles.map(({ id, browser, name }) => ({ id, browser, name }));
  }

  async preview(profileId: string): Promise<BrowserImportPreview> {
    const profile = await this.profile(profileId);
    const [bookmarks, source] = await Promise.all([readProfileBookmarks(profile.directory, profile.id), this.sourceExtensions(profile)]);
    const installed = new Set(this.extensions.list().map((extension) => extension.id));
    return { bookmarks, extensions: await Promise.all(source.map(async ({ extension, enabled }) => ({
      id: extension.id, name: await localizedExtensionName(extension, this.locale()), enabled,
      compatible: extension.manifest.manifest_version === 3, installed: installed.has(extension.id),
    }))) };
  }

  async importExtensions(profileId: string, ids: readonly string[], signal: AbortSignal): Promise<BrowserExtensionImportResult> {
    if (!Array.isArray(ids) || ids.length > 500 || !ids.every(validExtensionId) || new Set(ids).size !== ids.length) {
      throw new Error('Invalid extension import selection.');
    }
    const profile = await this.profile(profileId);
    const source = await this.sourceExtensions(profile);
    const selected = ids.map((id) => source.find(({ extension }) => extension.id === id));
    if (selected.some((item) => !item || item.extension.manifest.manifest_version !== 3)) throw new Error('Unknown extension import selection.');
    const imported: string[] = []; const skipped: string[] = []; const failed: string[] = [];
    for (const item of selected) {
      signal.throwIfAborted();
      if (!item) continue;
      try {
        const changed = await this.extensions.importInstallation(item.extension, item.enabled, signal);
        (changed ? imported : skipped).push(item.extension.id);
      } catch {
        signal.throwIfAborted();
        failed.push(item.extension.id);
      }
    }
    return { imported, skipped, failed };
  }

  private async profile(id: string): Promise<NativeBrowserProfile> {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error('Unknown browser profile.');
    await validateBrowserProfile(profile);
    return profile;
  }

  private async sourceExtensions(profile: NativeBrowserProfile) {
    const directory = path.join(profile.directory, 'Extensions');
    let location: string;
    try { location = await realpath(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (!withinDirectory(profile.directory, location)) throw new Error('Invalid browser extension directory.');
    const [extensions, preferences, secure] = await Promise.all([
      readInstalledExtensions(location, 2), readProfileJson(profile.directory, 'Preferences'), readProfileJson(profile.directory, 'Secure Preferences'),
    ]);
    return extensions.map((extension) => {
      const state = extensionState(secure, extension.id) ?? extensionState(preferences, extension.id);
      return { extension, enabled: state === undefined || state === 1 };
    });
  }
}

function extensionState(data: Record<string, unknown> | null, id: string): number | undefined {
  const extensions = data?.extensions;
  const settings = isRecord(extensions) ? extensions.settings : null;
  const entry = isRecord(settings) ? settings[id] : null;
  return isRecord(entry) && typeof entry.state === 'number' ? entry.state : undefined;
}

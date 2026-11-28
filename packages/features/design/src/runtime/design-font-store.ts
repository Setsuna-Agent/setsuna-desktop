import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { designCustomFontCodec, isDesignFontId, maxDesignFontBytes, type DesignCustomFont } from '../contracts/design-fonts.js';
import { inspectDesignFont } from './inspect-design-font.js';

export class DesignFontStore {
  private readonly directory: string;

  constructor(private readonly dataDir: string) {
    this.directory = path.join(dataDir, 'features', 'design', 'fonts');
  }

  async list(signal: AbortSignal): Promise<readonly DesignCustomFont[]> {
    if (!await this.managedDirectory()) return [];
    const entries = await readdir(this.directory, { withFileTypes: true }).catch((error: unknown) => {
      if (missing(error)) return [];
      throw error;
    });
    const fonts: DesignCustomFont[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isDesignFontId(entry.name)) continue;
      const font = await this.metadata(entry.name, signal);
      if (font) fonts.push(font);
    }
    return fonts.sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async import(base64: string, signal: AbortSignal): Promise<DesignCustomFont> {
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > maxDesignFontBytes || bytes.toString('base64') !== base64) throw invalidFont();
    const id = createHash('sha256').update(bytes).digest('hex');
    const previous = await this.managedDirectory() && await this.metadata(id, signal);
    if (previous) return previous;
    let font: DesignCustomFont;
    try {
      font = designCustomFontCodec.parse({ id, ...await inspectDesignFont(bytes) });
    } catch { throw invalidFont(); }
    signal.throwIfAborted();
    await this.managedDirectory(true);
    const staging = await mkdtemp(path.join(this.directory, '.import-'));
    try {
      await writeFile(path.join(staging, 'font'), bytes, { signal });
      await writeFile(path.join(staging, 'metadata.json'), JSON.stringify(font), { signal });
      signal.throwIfAborted();
      // Publish the metadata and source together. Identical imports share the same content ID.
      await rename(staging, this.fontPath(id));
      return font;
    } catch (error) {
      const installed = await this.metadata(id, signal);
      if (installed) return installed;
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async read(id: string, signal: AbortSignal): Promise<{ base64: string }> {
    const bytes = await this.managedDirectory() ? await this.readEntry(id, 'font', maxDesignFontBytes, signal) : undefined;
    if (!bytes?.length) throw new FeatureOperationFailure({ code: 'DESIGN_FONT_NOT_FOUND', message: 'Design font not found.', retryable: false });
    return { base64: bytes.toString('base64') };
  }

  async remove(id: string, signal: AbortSignal): Promise<null> {
    const target = this.fontPath(id);
    if (!await this.managedDirectory()) return null;
    const staging = await mkdtemp(path.join(this.directory, '.remove-')).catch((error: unknown) => {
      if (missing(error)) return null;
      throw error;
    });
    if (!staging) return null;
    try {
      signal.throwIfAborted();
      await rename(target, path.join(staging, 'font'));
    } catch (error) {
      if (!missing(error)) throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return null;
  }

  private fontPath(id: string) {
    if (!isDesignFontId(id)) throw new Error('Invalid design font ID.');
    return path.join(this.directory, id);
  }

  private async managedDirectory(create = false): Promise<boolean> {
    // An ancestor link must not redirect cleanup or staging into a user-owned font directory.
    let directory = await realpath(this.dataDir);
    for (const name of ['features', 'design', 'fonts']) {
      directory = path.join(directory, name);
      if (create) await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      const stats = await lstat(directory).catch((error: unknown) => {
        if (missing(error)) return null;
        throw error;
      });
      if (!stats) return false;
      if (!stats.isDirectory()) throw new Error('The design font directory has changed.');
    }
    return true;
  }

  private async metadata(id: string, signal: AbortSignal) {
    const bytes = await this.readEntry(id, 'metadata.json', 8_192, signal);
    if (!bytes) return;
    const metadata = designCustomFontCodec.parse(JSON.parse(bytes.toString('utf-8')));
    if (metadata.id !== id) throw new Error('Design font metadata does not match its source.');
    return metadata;
  }

  private async readEntry(id: string, name: 'font' | 'metadata.json', maxBytes: number, signal: AbortSignal) {
    const folder = this.fontPath(id);
    const file = path.join(folder, name);
    signal.throwIfAborted();
    try {
      if (!(await lstat(folder)).isDirectory()) return;
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > maxBytes) return;
      return await readFile(file, { signal });
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
  }
}

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function invalidFont() {
  return new FeatureOperationFailure({ code: 'DESIGN_FONT_INVALID', message: 'The design font is invalid or unsupported.', retryable: false });
}

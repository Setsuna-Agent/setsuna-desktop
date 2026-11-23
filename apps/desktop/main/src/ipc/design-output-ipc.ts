import { realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { designDirectoryGrant, designDirectoryGrants } from '@setsuna-desktop/feature-design/contracts';
import { writeJsonAtomically } from '../data-root/atomic-json.js';
import { clipboard, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  isValidWorkspaceEntryName, MAX_DESIGN_SVG_BYTES, WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  type DesktopDesignHtmlResult, type DesktopDesignPasteResult,
} from '@setsuna-desktop/contracts';
import { desktopWindows } from '../window/registry.js';

const layerFormat = 'com.setsuna-desktop.design-layers';
const maxExportBytes = 32 * 1024 * 1024;
const svgClipboardFormats = ['image/svg+xml', 'public.svg-image'];

export function registerDesignOutputIpc(runtimeRoot: string): void {
  for (const channel of ['desktop:choose-design-directory', 'desktop:copy-design-layers', 'desktop:read-design-layers', 'desktop:paste-design']) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle('desktop:choose-design-directory', async (event) => {
    const owner = designOwner(event);
    if (!owner) throw new Error('Desktop renderer is unavailable.');
    const choice = await dialog.showOpenDialog(owner, { properties: ['openDirectory', 'createDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const directory = await designDirectoryGrant(await realpath(choice.filePaths[0]));
    await writeJsonAtomically(path.join(runtimeRoot, designDirectoryGrants, directory.id + '.json'), directory.path);
    return directory;
  });
  ipcMain.handle('desktop:copy-design-layers', (event, content: unknown) => {
    if (!designOwner(event) || typeof content !== 'string' || Buffer.byteLength(content) > WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES) {
      throw new Error('Design clipboard data is unavailable or too large.');
    }
    clipboard.writeBuffer(layerFormat, Buffer.from(content));
  });
  ipcMain.handle('desktop:read-design-layers', (event) => {
    if (!designOwner(event)) return null;
    const content = clipboard.readBuffer(layerFormat);
    return content.length > 0 && content.length <= WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES ? content.toString('utf8') : null;
  });
  ipcMain.handle('desktop:paste-design', (event, acceptSvg: unknown): DesktopDesignPasteResult => {
    if (!designOwner(event)) return { kind: 'unavailable' };
    if (acceptSvg === true) {
      // Some apps offer both a bitmap and native SVG data. Prefer the editable SVG.
      for (const format of svgClipboardFormats) {
        const buffer = clipboard.readBuffer(format);
        if (!buffer.length) continue;
        if (buffer.length > MAX_DESIGN_SVG_BYTES) throw new Error('SVG clipboard content is too large.');
        const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le' : buffer[0] === 0xfe && buffer[1] === 0xff ? 'utf-16be' : 'utf-8';
        return { kind: 'svg', markup: new TextDecoder(encoding).decode(buffer).replace(/\0+$/u, '') };
      }
    }
    event.sender.paste();
    return { kind: 'issued' };
  });
  registerSaveDesignFile('html');
  registerSaveDesignFile('svg');
}

function registerSaveDesignFile(extension: 'html' | 'svg') {
  const channel = `desktop:save-design-${extension}`;
  const format = extension.toUpperCase();
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, input: unknown): Promise<DesktopDesignHtmlResult> => {
    const owner = designOwner(event);
    if (!owner) return { ok: false, error: 'Desktop renderer is unavailable.' };
    const value = input as Partial<Record<'name' | 'html' | 'svg', unknown>> | null;
    const content = value?.[extension];
    if (!isValidWorkspaceEntryName(value?.name) || !value.name.toLowerCase().endsWith(`.${extension}`)
      || typeof content !== 'string' || Buffer.byteLength(content) > maxExportBytes) return { ok: false, error: `The ${format} export is invalid or too large.` };
    try {
      const result = await dialog.showSaveDialog(owner, { defaultPath: value.name, filters: [{ name: format, extensions: [extension] }] });
      if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
      await writeFile(result.filePath, content, 'utf8');
      return { ok: true };
    } catch {
      return { ok: false, error: `The ${format} file could not be saved.` };
    }
  });
}

function designOwner(event: IpcMainInvokeEvent) {
  return event.senderFrame === event.sender.mainFrame ? desktopWindows.get(event.sender.id) : undefined;
}

import type { RuntimeInterfaceLanguage, RuntimePluginItemContent, RuntimePluginItemKind } from '@setsuna-desktop/contracts';
import { pluginItemFilePaths, readPluginFilePreview, type ParsedPluginManifest } from './file-plugin-bundle-model.js';
import { localizedPluginMarkdownPath } from './bundled-plugin-localization.js';

export function decodePluginUiText(content: Buffer, resourceId: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new Error(`Plugin UI resource must be UTF-8 text: ${resourceId}`);
  }
}

export async function readManifestItemContent(
  manifest: ParsedPluginManifest,
  kind: RuntimePluginItemKind,
  itemId: string,
  language?: RuntimeInterfaceLanguage,
): Promise<RuntimePluginItemContent> {
  const files = await Promise.all(
    pluginItemFilePaths(manifest, kind, itemId).map(async (filePath) => readPluginFilePreview(
      manifest.sourcePath,
      await localizedPluginMarkdownPath(manifest.sourcePath, filePath, language),
      true,
    )),
  );
  return { pluginId: manifest.id, itemId, kind, files };
}

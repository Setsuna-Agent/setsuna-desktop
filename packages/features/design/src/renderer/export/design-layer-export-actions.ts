import type { DesignLayerExport } from '../../contracts/design-export.js';
import type { DesignAssets } from '../client.js';

export async function copyDesignLayerExport(output: DesignAssets['output'], file: DesignLayerExport) {
  if (file.kind !== 'png') {
    await output.copyText(file.content);
    return true;
  }
  const result = await output.copyImageToClipboard({ name: file.name, dataUrl: file.content });
  if (!result.ok) throw new Error(result.error);
  return !result.cancelled;
}

export async function saveDesignLayerExport(output: DesignAssets['output'], file: DesignLayerExport) {
  const result = file.kind === 'png' ? await output.saveImageAs({ name: file.name, dataUrl: file.content })
    : file.kind === 'svg' ? await output.saveDesignSvg({ name: file.name, svg: file.content })
      : await output.saveDesignHtml({ name: file.name, html: file.content });
  if (!result.ok) throw new Error(result.error);
  return !result.cancelled;
}

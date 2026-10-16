import { useCallback } from 'react';
import { createDesktopRuntimeClient } from '../../../services/runtime-client/client.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { workspaceImageClipboardInput, type WorkspaceImageSource } from '../media/workspaceImageClipboard.js';
import { useDesktopImageAction } from './useDesktopImageAction.js';

export function useWorkspaceImageCopy() {
  const { t } = useI18n();
  const runImageAction = useDesktopImageAction();

  return useCallback((source: WorkspaceImageSource) => runImageAction('copy', async () => {
    let dataUrl: string;
    if ('dataUrl' in source) dataUrl = source.dataUrl;
    else {
      // The menu owns its original directory/path; reading must not navigate the active preview.
      const file = await createDesktopRuntimeClient().readProjectFile(source.workspace, source.filePath);
      if (file.preview?.kind !== 'image') {
        throw new Error(t(file.preview?.kind === 'unsupported' && file.preview.reason === 'image-too-large'
          ? 'workspace.files.imageTooLarge' : 'chat.image.unavailable'));
      }
      dataUrl = `data:${file.preview.mimeType};base64,${file.preview.base64}`;
    }
    return workspaceImageClipboardInput(dataUrl, source.filePath);
  }), [runImageAction, t]);
}

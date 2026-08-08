import type { DesktopImageInput } from '@setsuna-desktop/contracts';
import { useCallback } from 'react';
import { useToast } from '../../../app/providers/ToastProvider.js';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';

export type DesktopImageAction = 'copy' | 'reveal';

export function useDesktopImageAction() {
  const toast = useToast();
  const { t } = useI18n();

  return useCallback(async (action: DesktopImageAction, input: DesktopImageInput): Promise<boolean> => {
    const desktop = window.setsunaDesktop?.desktop;
    if (!desktop) {
      toast.error(t('workspace.image.unsupported'));
      return false;
    }
    try {
      const result = action === 'copy'
        ? await desktop.copyImageToClipboard(input)
        : await desktop.revealImageInFolder(input);
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      toast.success(desktopImageActionSuccessMessage(action, t));
      return true;
    } catch (unknownError) {
      toast.error(unknownError instanceof Error ? unknownError.message : t('workspace.image.failed'));
      return false;
    }
  }, [t, toast]);
}

function desktopImageActionSuccessMessage(action: DesktopImageAction, t: Translate): string {
  return t(action === 'copy' ? 'workspace.image.copied' : 'workspace.image.revealed');
}

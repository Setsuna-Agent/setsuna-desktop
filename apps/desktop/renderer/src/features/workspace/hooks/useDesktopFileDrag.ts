import type { DesktopFileDragInput } from '@setsuna-desktop/contracts';
import { useCallback, type DragEvent } from 'react';
import { useToast } from '../../../app/providers/ToastProvider.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

export function useDesktopFileDrag() {
  const toast = useToast();
  const { t } = useI18n();
  return useCallback((event: DragEvent<HTMLElement>, input: DesktopFileDragInput) => {
    // Cancel Chromium's URL/text drag; Electron supplies the OS file payload instead.
    event.preventDefault();
    event.stopPropagation();
    const start = window.setsunaDesktop?.desktop.startFileDrag;
    if (!start) { toast.error(t('workspace.files.dragFailed')); return; }
    void start(input).then((result) => {
      if (!result.ok) toast.error(result.error);
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('workspace.files.dragFailed'));
    });
  }, [t, toast]);
}

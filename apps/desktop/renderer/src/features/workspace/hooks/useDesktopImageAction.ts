import type { DesktopImageInput } from '@setsuna-desktop/contracts';
import { useCallback } from 'react';
import { useToast } from '../../../app/providers/ToastProvider.js';

export type DesktopImageAction = 'copy' | 'reveal';

export function useDesktopImageAction() {
  const toast = useToast();

  return useCallback(async (action: DesktopImageAction, input: DesktopImageInput): Promise<boolean> => {
    const desktop = window.setsunaDesktop?.desktop;
    if (!desktop) {
      toast.error('当前环境无法执行图片操作。');
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
      toast.success(desktopImageActionSuccessMessage(action));
      return true;
    } catch (unknownError) {
      toast.error(unknownError instanceof Error ? unknownError.message : '图片操作失败。');
      return false;
    }
  }, [toast]);
}

export function desktopImageActionSuccessMessage(action: DesktopImageAction): string {
  return action === 'copy' ? '图片已复制' : '已在文件夹中显示图片';
}

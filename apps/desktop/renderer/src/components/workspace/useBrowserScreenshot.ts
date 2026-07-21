import { useCallback, useRef, useState } from 'react';
import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import { useToast, type ToastTone } from '../ToastProvider.js';
import type { ChatImageAttachmentOutcome } from '../../types/app.js';

export type BrowserScreenshotAttachmentHandler = (
  attachment: RuntimeMessageAttachment,
) => ChatImageAttachmentOutcome | Promise<ChatImageAttachmentOutcome>;

export type BrowserScreenshotFeedback = {
  message: string;
  tone: ToastTone;
};

export function useBrowserScreenshot({
  activeTabId,
  onAttachment,
}: {
  activeTabId: string | null;
  onAttachment?: BrowserScreenshotAttachmentHandler;
}) {
  const toast = useToast();
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);

  const captureScreenshot = useCallback(async () => {
    if (!activeTabId || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    let copiedToClipboard = false;
    try {
      const screenshot = await window.setsunaDesktop?.browser.captureScreenshot(activeTabId);
      if (!screenshot) throw new Error('Browser screenshot capture failed.');
      copiedToClipboard = true;
      const timestamp = Date.now();
      const outcome = onAttachment
        ? await onAttachment({
            id: `browser_screenshot_${timestamp.toString(36)}`,
            name: `browser-screenshot-${timestamp}.png`,
            type: screenshot.mimeType,
            size: screenshot.size,
            url: screenshot.dataUrl,
          })
        : 'unavailable';
      const feedback = browserScreenshotOutcomeFeedback(outcome);
      toast.show(feedback.message, { tone: feedback.tone });
    } catch {
      if (copiedToClipboard) toast.warning('截图已复制到剪切板，但未能添加到输入框');
      else toast.error('截图失败，请重试');
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [activeTabId, onAttachment, toast]);

  return { captureScreenshot, capturing };
}

export function browserScreenshotOutcomeFeedback(outcome: ChatImageAttachmentOutcome): BrowserScreenshotFeedback {
  switch (outcome) {
    case 'added':
      return { tone: 'success', message: '截图已添加到输入框，并复制到剪切板' };
    case 'unsupported':
      return { tone: 'warning', message: '当前模型不支持图片，截图已复制到剪切板' };
    case 'limit-reached':
      return { tone: 'warning', message: '输入框图片已达上限，截图已复制到剪切板' };
    case 'too-large':
      return { tone: 'warning', message: '截图文件过大，已复制到剪切板' };
    case 'unavailable':
      return { tone: 'warning', message: '截图已复制到剪切板，但未能添加到输入框' };
  }
}

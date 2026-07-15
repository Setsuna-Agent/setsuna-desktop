import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import type { ChatImageAttachmentOutcome } from '../../types/app.js';

export type BrowserScreenshotAttachmentHandler = (
  attachment: RuntimeMessageAttachment,
) => ChatImageAttachmentOutcome | Promise<ChatImageAttachmentOutcome>;

export type BrowserScreenshotNotice = {
  kind: 'error' | 'success' | 'warning';
  message: string;
};

export function useBrowserScreenshot({
  activeTabId,
  onAttachment,
}: {
  activeTabId: string | null;
  onAttachment?: BrowserScreenshotAttachmentHandler;
}) {
  const [capturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<BrowserScreenshotNotice | null>(null);
  const capturingRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = useCallback((nextNotice: BrowserScreenshotNotice) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice(nextNotice);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, 3_200);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

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
      showNotice(browserScreenshotOutcomeNotice(outcome));
    } catch {
      showNotice(copiedToClipboard
        ? { kind: 'warning', message: '截图已复制到剪切板，但未能添加到输入框' }
        : { kind: 'error', message: '截图失败，请重试' });
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [activeTabId, onAttachment, showNotice]);

  return { captureScreenshot, capturing, notice };
}

function browserScreenshotOutcomeNotice(outcome: ChatImageAttachmentOutcome): BrowserScreenshotNotice {
  switch (outcome) {
    case 'added':
      return { kind: 'success', message: '截图已添加到输入框，并复制到剪切板' };
    case 'unsupported':
      return { kind: 'warning', message: '当前模型不支持图片，截图已复制到剪切板' };
    case 'limit-reached':
      return { kind: 'warning', message: '输入框图片已达上限，截图已复制到剪切板' };
    case 'too-large':
      return { kind: 'warning', message: '截图文件过大，已复制到剪切板' };
    case 'unavailable':
      return { kind: 'warning', message: '截图已复制到剪切板，但未能添加到输入框' };
  }
}

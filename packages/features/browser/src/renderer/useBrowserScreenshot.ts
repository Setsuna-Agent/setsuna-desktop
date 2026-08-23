import { useCallback, useRef, useState } from 'react';
import type { BrowserDesktopBridge } from '../contracts/index.js';
import {
  translateBrowserMessage,
  type BrowserTranslate,
} from './messages.js';
import type {
  BrowserNotificationTone,
  BrowserNotify,
  BrowserScreenshotAttachmentHandler,
  BrowserScreenshotAttachmentOutcome,
} from './types.js';

const defaultTranslate: BrowserTranslate = (key) => translateBrowserMessage('zh-CN', key);

export type BrowserScreenshotFeedback = {
  message: string;
  tone: BrowserNotificationTone;
};

export function useBrowserScreenshot({
  activeTabId,
  bridge,
  notify,
  onAttachment,
  translate,
}: {
  activeTabId: string | null;
  bridge: BrowserDesktopBridge | null;
  notify: BrowserNotify;
  onAttachment?: BrowserScreenshotAttachmentHandler;
  translate: BrowserTranslate;
}) {
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);

  const captureScreenshot = useCallback(async () => {
    if (!activeTabId || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    let copiedToClipboard = false;
    try {
      const screenshot = await bridge?.captureScreenshot(activeTabId);
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
      const feedback = browserScreenshotOutcomeFeedback(outcome, translate);
      notify(feedback.tone, feedback.message);
    } catch {
      if (copiedToClipboard) notify('warning', translate('feature.browser.screenshot.unavailable'));
      else notify('error', translate('feature.browser.screenshot.failed'));
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [activeTabId, bridge, notify, onAttachment, translate]);

  return { captureScreenshot, capturing };
}

export function browserScreenshotOutcomeFeedback(
  outcome: BrowserScreenshotAttachmentOutcome,
  translate: BrowserTranslate = defaultTranslate,
): BrowserScreenshotFeedback {
  switch (outcome) {
    case 'added':
      return { tone: 'success', message: translate('feature.browser.screenshot.added') };
    case 'unsupported':
      return { tone: 'warning', message: translate('feature.browser.screenshot.unsupported') };
    case 'limit-reached':
      return { tone: 'warning', message: translate('feature.browser.screenshot.limitReached') };
    case 'unavailable':
      return { tone: 'warning', message: translate('feature.browser.screenshot.unavailable') };
  }
}

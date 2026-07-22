import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import { useCallback, useRef, useState } from 'react';
import { useToast, type ToastTone } from '../../app/providers/ToastProvider.js';
import type { ChatImageAttachmentOutcome } from '../../app/types.js';
import { translate, useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

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
  const { t } = useI18n();
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
      const feedback = browserScreenshotOutcomeFeedback(outcome, t);
      toast.show(feedback.message, { tone: feedback.tone });
    } catch {
      if (copiedToClipboard) toast.warning(t('workspace.browser.screenshot.unavailable'));
      else toast.error(t('workspace.browser.screenshot.failed'));
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [activeTabId, onAttachment, t, toast]);

  return { captureScreenshot, capturing };
}

export function browserScreenshotOutcomeFeedback(
  outcome: ChatImageAttachmentOutcome,
  t: Translate = defaultTranslate,
): BrowserScreenshotFeedback {
  switch (outcome) {
    case 'added':
      return { tone: 'success', message: t('workspace.browser.screenshot.added') };
    case 'unsupported':
      return { tone: 'warning', message: t('workspace.browser.screenshot.unsupported') };
    case 'limit-reached':
      return { tone: 'warning', message: t('workspace.browser.screenshot.limitReached') };
    case 'too-large':
      return { tone: 'warning', message: t('workspace.browser.screenshot.tooLarge') };
    case 'unavailable':
      return { tone: 'warning', message: t('workspace.browser.screenshot.unavailable') };
  }
}

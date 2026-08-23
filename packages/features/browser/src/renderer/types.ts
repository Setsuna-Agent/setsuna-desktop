import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import type { ComponentType, ReactNode } from 'react';

export type BrowserNotificationTone = 'error' | 'success' | 'warning';
export type BrowserNotify = (tone: BrowserNotificationTone, message: string) => void;

export type BrowserScreenshotAttachmentOutcome =
  | 'added'
  | 'limit-reached'
  | 'unavailable'
  | 'unsupported';

export type BrowserScreenshotAttachmentHandler = (
  attachment: RuntimeMessageAttachment,
) => BrowserScreenshotAttachmentOutcome | Promise<BrowserScreenshotAttachmentOutcome>;

export type BrowserSelectFieldProps = Readonly<{
  'aria-label'?: string;
  children: ReactNode;
  className?: string;
  onValueChange: (value: string) => boolean | void;
  value: string;
}>;

export type BrowserSelectFieldComponent = ComponentType<BrowserSelectFieldProps>;

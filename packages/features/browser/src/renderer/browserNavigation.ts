import { BROWSER_HOME_URL, DEFAULT_BROWSER_URL } from '../contracts/index.js';
import type { BrowserTranslate } from './messages.js';

const browserZoomFactors = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export type BrowserZoomDirection = 'in' | 'out' | 'reset';

export function nextBrowserZoomFactor(current: number, direction: BrowserZoomDirection): number {
  if (direction === 'reset') return 1;
  if (direction === 'in') {
    return browserZoomFactors.find((factor) => factor > current + 0.001)
      ?? browserZoomFactors.at(-1)!;
  }
  for (let index = browserZoomFactors.length - 1; index >= 0; index -= 1) {
    const factor = browserZoomFactors[index];
    if (factor < current - 0.001) return factor;
  }
  return browserZoomFactors[0];
}

export function normalizeBrowserInput(input: string): string {
  const value = input.trim();
  if (!value) return DEFAULT_BROWSER_URL;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?:\/|$)/i.test(value)) {
    return `http://${value}`;
  }
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/|$)/i.test(value)) return `https://${value}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
}

export function isBrowserHomeUrl(url: string): boolean {
  return url.trim().toLowerCase() === BROWSER_HOME_URL;
}

export function isAbortedNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ERR_ABORTED|\(-3\)/.test(message);
}

export function browserHostLabel(rawUrl: string, translate: BrowserTranslate): string {
  try {
    return new URL(rawUrl).hostname || translate('feature.browser.newTab');
  } catch {
    return translate('feature.browser.newTab');
  }
}

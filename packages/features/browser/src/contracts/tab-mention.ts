import type { DesktopBrowserTab } from './browser-control.js';

export type BrowserTabReference = Pick<DesktopBrowserTab, 'id' | 'title' | 'url'>;
export type BrowserTabMention = { tab: BrowserTabReference; start: number; end: number };

/** Keep the tab identity in message text so drafts, queued turns and history retain it. */
export function browserTabMentionText(tab: BrowserTabReference): string {
  const title = (tab.title.replace(/[[\]\p{Cc}]/gu, ' ').trim()
    || tab.url.replace(/[[\]\p{Cc}]/gu, ' ')).slice(0, 200);
  return `[@${title}](browser-tab://${encodeLinkPart(tab.id)}?url=${encodeLinkPart(tab.url)})`;
}

export function parseBrowserTabMentions(content: string): BrowserTabMention[] {
  const mentions: BrowserTabMention[] = [];
  const pattern = /\[@([^\]\r\n]{1,200})\]\(browser-tab:\/\/([^?\s()]+)\?url=([^\s()]+)\)/gu;
  for (const match of content.matchAll(pattern)) {
    try {
      const tab = { id: decodeURIComponent(match[2]), title: match[1], url: decodeURIComponent(match[3]) };
      if (isBrowserTabReference(tab)) mentions.push({ tab, start: match.index, end: match.index + match[0].length });
    } catch { /* Invalid pasted links remain ordinary text. */ }
  }
  return mentions;
}

export function isBrowserTabReference(value: unknown): value is BrowserTabReference {
  if (!value || typeof value !== 'object') return false;
  const tab = value as Partial<BrowserTabReference>;
  if (typeof tab.id !== 'string' || !tab.id || /[\s\p{Cc}]/u.test(tab.id)
    || typeof tab.title !== 'string' || typeof tab.url !== 'string') return false;
  try {
    const url = new URL(tab.url);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function encodeLinkPart(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16)}`);
}

import { createContext, Fragment, useContext, type ReactNode } from 'react';
import { parseBrowserTabMentions, type BrowserTabReference } from '@setsuna-desktop/feature-browser/contracts';
import { BrowserFavicon } from '../../../composition/BrowserWorkspaceFeatureBoundary.js';
import { composerCursorOffsetAdjustment } from '../composer/chatComposerCursorOffset.js';
import { ChatInlineReference } from '../references/ChatInlineReference.js';
import { WorkspaceMentionText } from './WorkspaceMentionText.js';
import type { BrowserTabMentionCandidate } from './chatMentionItems.js';

const BrowserTabs = createContext<readonly BrowserTabMentionCandidate[]>([]);
export const BrowserTabMentionsProvider = BrowserTabs.Provider;
export function useBrowserTabMentions() { return useContext(BrowserTabs); }

export function BrowserTabReferenceLabel({ tab, serializedText }: {
  tab: BrowserTabReference;
  serializedText?: string;
}) {
  const label = tab.title || tab.url;
  const source = useBrowserTabMentions().find((candidate) => candidate.id === tab.id && candidate.url === tab.url);
  return <ChatInlineReference
    icon={<BrowserFavicon faviconUrl={source?.faviconUrl ?? null} loading={false} />}
    label={label}
    title={tab.url}
    composerCursorOffsetAdjustment={serializedText === undefined
      ? undefined : composerCursorOffsetAdjustment(serializedText, label)}
  />;
}

export function BrowserTabReferenceText({ content }: { content: string }) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const mention of parseBrowserTabMentions(content)) {
    parts.push(<WorkspaceMentionText key={`text:${offset}`} content={content.slice(offset, mention.start)} />);
    parts.push(<BrowserTabReferenceLabel key={`tab:${mention.start}`} tab={mention.tab} />);
    offset = mention.end;
  }
  parts.push(<WorkspaceMentionText key={`text:${offset}`} content={content.slice(offset)} />);
  return <Fragment>{parts}</Fragment>;
}

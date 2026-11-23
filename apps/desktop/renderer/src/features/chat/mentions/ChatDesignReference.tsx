import { chatDesignTitle, designMentionText, parseDesignMentions, type DesignConversationOwner } from '@setsuna-desktop/feature-design/contracts';
import { PanelsTopLeft } from 'lucide-react';
import { createContext, Fragment, useContext, type ReactNode } from 'react';
import type { ChatComposerReferenceSlot } from '../composer/chatComposerSlots.js';
import { ChatInlineReference } from '../references/ChatInlineReference.js';
import { WorkspaceMentionText } from './WorkspaceMentionText.js';

const Navigation = createContext<((owner: DesignConversationOwner) => void) | undefined>(undefined);
export const ChatDesignNavigation = Navigation.Provider;
export function useOpenChatDesign() { return useContext(Navigation); }

export function ChatDesignLabel({ owner }: { owner: DesignConversationOwner }) {
  const open = useOpenChatDesign();
  return <ChatInlineReference icon={<PanelsTopLeft size={14} />} label={chatDesignTitle(owner)} title={owner.ref.path}
    onActivate={open && (() => open(owner))} />;
}

export function designMentionSlot(owner: DesignConversationOwner, value = designMentionText(owner)): ChatComposerReferenceSlot {
  return { type: 'tag', key: 'design:' + crypto.randomUUID(), composerReference: { type: 'design', value },
    props: { label: <ChatDesignLabel owner={owner} />, value } };
}

export function ChatDesignReferenceText({ content }: { content: string }) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const { owner, start, end } of parseDesignMentions(content)) {
    parts.push(<WorkspaceMentionText key={offset} content={content.slice(offset, start)} />);
    parts.push(<ChatDesignLabel key={'design:' + start} owner={owner} />);
    offset = end;
  }
  return <Fragment>{parts}<WorkspaceMentionText content={content.slice(offset)} /></Fragment>;
}

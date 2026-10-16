import { Fragment, type ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import { parseThreadMentions, type RuntimeThreadReference } from '@setsuna-desktop/contracts';
import { ChatInlineReference } from '../references/ChatInlineReference.js';
import { WorkspaceMentionText } from './WorkspaceMentionText.js';

export function ThreadReferenceLabel({ thread }: {
  thread: RuntimeThreadReference;
}) {
  const label = thread.title || thread.id;
  return <ChatInlineReference
    icon={<MessageSquare size={14} />}
    label={label}
    title={label}
  />;
}

export function ThreadReferenceText({ content }: { content: string }) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const mention of parseThreadMentions(content)) {
    parts.push(<WorkspaceMentionText key={`text:${offset}`} content={content.slice(offset, mention.start)} />);
    parts.push(<ThreadReferenceLabel key={`thread:${mention.start}`} thread={mention.thread} />);
    offset = mention.end;
  }
  parts.push(<WorkspaceMentionText key={`text:${offset}`} content={content.slice(offset)} />);
  return <Fragment>{parts}</Fragment>;
}

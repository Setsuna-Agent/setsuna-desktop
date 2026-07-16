import { Fragment, memo } from 'react';
import { WorkspaceMentionLabel } from './WorkspaceMentionLabel.js';
import { parseWorkspaceMentionText } from './workspaceMentionParser.js';
import { useMarkdownNavigation } from './markdown/MarkdownNavigationProvider.js';

export const WorkspaceMentionText = memo(function WorkspaceMentionText({ content }: { content: string }) {
  const { onOpenWorkspaceFile } = useMarkdownNavigation();
  return (
    <>
      {parseWorkspaceMentionText(content).map((part) => (
        part.type === 'text' ? (
          <Fragment key={`text:${part.start}`}>{part.value}</Fragment>
        ) : (
          <WorkspaceMentionLabel
            key={`mention:${part.start}`}
            onOpen={onOpenWorkspaceFile}
            path={part.path}
            type={part.entryType}
          />
        )
      ))}
    </>
  );
});

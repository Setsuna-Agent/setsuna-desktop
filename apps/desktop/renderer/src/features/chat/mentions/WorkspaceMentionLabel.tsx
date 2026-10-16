import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { memo } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { WorkspaceEntryIcon } from '../../workspace/WorkspaceEntryIcon.js';
import { ChatInlineReference } from '../references/ChatInlineReference.js';

type WorkspaceMentionLabelProps = {
  name?: string;
  onOpen?: (path: string) => void;
  path: string;
  type: WorkspaceEntry['type'];
};

export const WorkspaceMentionLabel = memo(function WorkspaceMentionLabel({
  name,
  onOpen,
  path,
  type,
}: WorkspaceMentionLabelProps) {
  const { t } = useI18n();
  const displayText = workspaceMentionDisplayText(name, path, type);
  return (
    <ChatInlineReference
      actionLabel={onOpen
        ? t(type === 'directory' ? 'chat.mention.openDirectory' : 'chat.mention.openDefault', { path })
        : undefined}
      className="chat-workspace-mention"
      icon={<WorkspaceEntryIcon path={path} type={type} />}
      label={displayText}
      onActivate={onOpen ? () => onOpen(path) : undefined}
      title={path}
    />
  );
});

function workspaceMentionDisplayText(name: string | undefined, path: string, type: WorkspaceEntry['type']): string {
  const fallback = path.split('/').filter(Boolean).pop() || path;
  const displayName = name?.trim() || fallback;
  return type === 'directory' ? displayName.replace(/\/$/u, '') : displayName;
}

import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { memo } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { WorkspaceEntryIcon } from '../../workspace/WorkspaceEntryIcon.js';
import { composerCursorOffsetAdjustment } from '../composer/chatComposerCursorOffset.js';

type WorkspaceMentionLabelProps = {
  name?: string;
  onOpen?: (path: string) => void;
  path: string;
  serializedText?: string;
  type: WorkspaceEntry['type'];
};

export const WorkspaceMentionLabel = memo(function WorkspaceMentionLabel({
  name,
  onOpen,
  path,
  serializedText,
  type,
}: WorkspaceMentionLabelProps) {
  const { t } = useI18n();
  const displayText = workspaceMentionDisplayText(name, path, type);
  const cursorOffsetAdjustment = serializedText === undefined
    ? undefined
    : composerCursorOffsetAdjustment(serializedText, displayText);
  const content = (
    <>
      <WorkspaceEntryIcon className="chat-workspace-mention__icon" path={path} size={13} type={type} />
      <span>{displayText}</span>
    </>
  );

  if (onOpen && type === 'file') {
    return (
      <button
        aria-label={t('chat.mention.openDefault', { path })}
        className="chat-workspace-mention chat-workspace-mention--action"
        title={path}
        type="button"
        onClick={() => onOpen(path)}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className="chat-workspace-mention"
      title={path}
      data-composer-cursor-offset-adjustment={cursorOffsetAdjustment}
    >
      {content}
    </span>
  );
});

function workspaceMentionDisplayText(name: string | undefined, path: string, type: WorkspaceEntry['type']): string {
  const fallback = path.split('/').filter(Boolean).pop() || path;
  const displayName = name?.trim() || fallback;
  return type === 'directory' ? `${displayName.replace(/\/$/u, '')}/` : displayName;
}

import { AnchoredPopover } from '@setsuna-desktop/renderer-ui';
import { useCallback, type RefObject } from 'react';
import type { ChatMentionItem } from '../mentions/chatMentionItems.js';
import { composerCaretRect } from './editor/composerCaretRect.js';
import type { ComposerEditor } from './editor/types.js';
import { ChatMentionCommandMenu } from './ChatCommandMenus.js';
import {
  ChatSlashCommandMenu,
  type SlashCommandMenuItem,
} from './ChatSlashCommandMenu.js';

type CommandMenuAnchor =
  | { anchor: 'composer'; editorRef?: never }
  | { anchor: 'caret'; editorRef: RefObject<ComposerEditor | null> };

export function ChatComposerOverlays({
  anchor,
  editorRef,
  mentionMenu,
  slashMenu,
}: CommandMenuAnchor & {
  mentionMenu: {
    activeIndex: number;
    items: ChatMentionItem[];
    hasProject: boolean;
    loadError: string;
    loading: boolean;
    open: boolean;
    onHover: (index: number) => void;
    onSelect: (entry: ChatMentionItem) => void;
  };
  slashMenu: {
    activeIndex: number;
    items: SlashCommandMenuItem[];
    open: boolean;
    onHover: (index: number) => void;
    onSelect: (item: SlashCommandMenuItem) => void;
  };
}) {
  const getAnchorRect = useCallback(
    () => composerCaretRect(editorRef?.current?.inputElement ?? null),
    [editorRef],
  );
  if (!mentionMenu.open && !slashMenu.open) return null;

  const menus = (
    <>
      {mentionMenu.open ? (
        <ChatMentionCommandMenu
          compact={anchor === 'caret'}
          activeIndex={mentionMenu.activeIndex}
          items={mentionMenu.items}
          hasProject={mentionMenu.hasProject}
          loadError={mentionMenu.loadError}
          loading={mentionMenu.loading}
          onHover={mentionMenu.onHover}
          onSelect={mentionMenu.onSelect}
        />
      ) : null}
      {slashMenu.open ? (
        <ChatSlashCommandMenu
          compact={anchor === 'caret'}
          activeIndex={slashMenu.activeIndex}
          items={slashMenu.items}
          onHover={slashMenu.onHover}
          onSelect={slashMenu.onSelect}
        />
      ) : null}
    </>
  );

  // Only in-message editing follows the caret; composers keep their full-width menu above the input.
  return anchor === 'caret'
    ? <AnchoredPopover getAnchorRect={getAnchorRect} className="chat-command-popover">{menus}</AnchoredPopover>
    : menus;
}

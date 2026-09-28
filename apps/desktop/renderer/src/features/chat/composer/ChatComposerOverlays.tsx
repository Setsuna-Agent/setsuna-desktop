import type { ChatMentionItem } from '../mentions/chatMentionItems.js';
import { ChatMentionCommandMenu } from './ChatCommandMenus.js';
import {
  ChatSlashCommandMenu,
  type SlashCommandMenuItem,
} from './ChatSlashCommandMenu.js';

export function ChatComposerOverlays({
  mentionMenu,
  slashMenu,
}: {
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
  return (
    <>
      {mentionMenu.open ? (
        <ChatMentionCommandMenu
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
          activeIndex={slashMenu.activeIndex}
          items={slashMenu.items}
          onHover={slashMenu.onHover}
          onSelect={slashMenu.onSelect}
        />
      ) : null}
    </>
  );
}

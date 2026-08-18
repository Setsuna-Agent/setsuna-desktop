import type { WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { ProjectEntryCommandMenu } from './ChatCommandMenus.js';
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
    entries: WorkspaceEntrySearchItem[];
    hasProject: boolean;
    loadError: string;
    loading: boolean;
    open: boolean;
    onHover: (index: number) => void;
    onSelect: (entry: WorkspaceEntrySearchItem) => void;
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
        <ProjectEntryCommandMenu
          activeIndex={mentionMenu.activeIndex}
          entries={mentionMenu.entries}
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

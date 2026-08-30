import type { MessageKey } from '../i18n/messages.js';

export const KEYBOARD_SHORTCUT_PLATFORMS = ['darwin', 'win32', 'linux'] as const;

export type KeyboardShortcutPlatform = typeof KEYBOARD_SHORTCUT_PLATFORMS[number];

export const KEYBOARD_SHORTCUT_GROUPS = ['general', 'navigation', 'chat', 'workspace'] as const;

export type KeyboardShortcutGroup = typeof KEYBOARD_SHORTCUT_GROUPS[number];

export const KEYBOARD_SHORTCUT_COMMAND_IDS = [
  'app.newChat',
  'app.searchChats',
  'app.addProject',
  'app.openSettings',
  'app.openCapabilities',
  'app.toggleRuntimeActivity',
  'navigation.goBack',
  'navigation.goForward',
  'layout.toggleSidebar',
  'layout.toggleWorkspace',
  'layout.toggleTerminal',
  'chat.focusComposer',
  'chat.cancelTurn',
  'chat.toggleOverview',
  'workspace.openFiles',
  'workspace.openReview',
  'workspace.openTerminal',
  'workspace.openSideChat',
  'workspace.openBrowser',
  'workspace.openConversationDebug',
  'browser.reload',
  'browser.hardReload',
] as const;

export type KeyboardShortcutCommandId = typeof KEYBOARD_SHORTCUT_COMMAND_IDS[number];

export type KeyboardShortcutCommand = {
  id: KeyboardShortcutCommandId;
  group: KeyboardShortcutGroup;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  defaultBindings: Record<KeyboardShortcutPlatform, readonly string[]>;
};

const primaryBinding = (code: string, shift = false): KeyboardShortcutCommand['defaultBindings'] => ({
  darwin: [`${shift ? 'Shift+' : ''}Meta+${code}`],
  linux: [`Control+${shift ? 'Shift+' : ''}${code}`],
  win32: [`Control+${shift ? 'Shift+' : ''}${code}`],
});

export const keyboardShortcutCommands: readonly KeyboardShortcutCommand[] = [
  {
    id: 'app.newChat',
    group: 'general',
    labelKey: 'shortcuts.command.newChat',
    descriptionKey: 'shortcuts.command.newChatDescription',
    defaultBindings: primaryBinding('KeyN'),
  },
  {
    id: 'app.addProject',
    group: 'general',
    labelKey: 'shortcuts.command.addProject',
    descriptionKey: 'shortcuts.command.addProjectDescription',
    defaultBindings: primaryBinding('KeyO'),
  },
  {
    id: 'app.openSettings',
    group: 'general',
    labelKey: 'shortcuts.command.openSettings',
    descriptionKey: 'shortcuts.command.openSettingsDescription',
    defaultBindings: primaryBinding('Comma'),
  },
  {
    id: 'app.openCapabilities',
    group: 'general',
    labelKey: 'shortcuts.command.openCapabilities',
    descriptionKey: 'shortcuts.command.openCapabilitiesDescription',
    defaultBindings: primaryBinding('KeyX', true),
  },
  {
    id: 'app.toggleRuntimeActivity',
    group: 'general',
    labelKey: 'shortcuts.command.toggleRuntimeActivity',
    descriptionKey: 'shortcuts.command.toggleRuntimeActivityDescription',
    defaultBindings: primaryBinding('KeyA', true),
  },
  {
    id: 'app.searchChats',
    group: 'navigation',
    labelKey: 'shortcuts.command.searchChats',
    descriptionKey: 'shortcuts.command.searchChatsDescription',
    defaultBindings: primaryBinding('KeyK'),
  },
  {
    id: 'navigation.goBack',
    group: 'navigation',
    labelKey: 'shortcuts.command.goBack',
    descriptionKey: 'shortcuts.command.goBackDescription',
    defaultBindings: {
      darwin: ['Meta+BracketLeft'],
      linux: ['Alt+ArrowLeft'],
      win32: ['Alt+ArrowLeft'],
    },
  },
  {
    id: 'navigation.goForward',
    group: 'navigation',
    labelKey: 'shortcuts.command.goForward',
    descriptionKey: 'shortcuts.command.goForwardDescription',
    defaultBindings: {
      darwin: ['Meta+BracketRight'],
      linux: ['Alt+ArrowRight'],
      win32: ['Alt+ArrowRight'],
    },
  },
  {
    id: 'layout.toggleSidebar',
    group: 'navigation',
    labelKey: 'shortcuts.command.toggleSidebar',
    descriptionKey: 'shortcuts.command.toggleSidebarDescription',
    defaultBindings: primaryBinding('KeyB'),
  },
  {
    id: 'layout.toggleWorkspace',
    group: 'navigation',
    labelKey: 'shortcuts.command.toggleWorkspace',
    descriptionKey: 'shortcuts.command.toggleWorkspaceDescription',
    defaultBindings: primaryBinding('KeyB', true),
  },
  {
    id: 'layout.toggleTerminal',
    group: 'navigation',
    labelKey: 'shortcuts.command.toggleTerminal',
    descriptionKey: 'shortcuts.command.toggleTerminalDescription',
    defaultBindings: {
      darwin: ['Control+Backquote'],
      linux: ['Control+Backquote'],
      win32: ['Control+Backquote'],
    },
  },
  {
    id: 'chat.focusComposer',
    group: 'chat',
    labelKey: 'shortcuts.command.focusComposer',
    descriptionKey: 'shortcuts.command.focusComposerDescription',
    defaultBindings: primaryBinding('KeyL', true),
  },
  {
    id: 'chat.cancelTurn',
    group: 'chat',
    labelKey: 'shortcuts.command.cancelTurn',
    descriptionKey: 'shortcuts.command.cancelTurnDescription',
    defaultBindings: primaryBinding('Period'),
  },
  {
    id: 'chat.toggleOverview',
    group: 'chat',
    labelKey: 'shortcuts.command.toggleOverview',
    descriptionKey: 'shortcuts.command.toggleOverviewDescription',
    defaultBindings: primaryBinding('KeyO', true),
  },
  {
    id: 'workspace.openFiles',
    group: 'workspace',
    labelKey: 'shortcuts.command.openFiles',
    descriptionKey: 'shortcuts.command.openFilesDescription',
    defaultBindings: primaryBinding('KeyE', true),
  },
  {
    id: 'workspace.openReview',
    group: 'workspace',
    labelKey: 'shortcuts.command.openReview',
    descriptionKey: 'shortcuts.command.openReviewDescription',
    defaultBindings: primaryBinding('KeyG', true),
  },
  {
    id: 'workspace.openTerminal',
    group: 'workspace',
    labelKey: 'shortcuts.command.openTerminal',
    descriptionKey: 'shortcuts.command.openTerminalDescription',
    defaultBindings: primaryBinding('Backquote', true),
  },
  {
    id: 'workspace.openSideChat',
    group: 'workspace',
    labelKey: 'shortcuts.command.openSideChat',
    descriptionKey: 'shortcuts.command.openSideChatDescription',
    defaultBindings: primaryBinding('KeyS', true),
  },
  {
    id: 'workspace.openBrowser',
    group: 'workspace',
    labelKey: 'shortcuts.command.openBrowser',
    descriptionKey: 'shortcuts.command.openBrowserDescription',
    defaultBindings: primaryBinding('KeyT'),
  },
  {
    id: 'workspace.openConversationDebug',
    group: 'workspace',
    labelKey: 'shortcuts.command.openConversationDebug',
    descriptionKey: 'shortcuts.command.openConversationDebugDescription',
    defaultBindings: primaryBinding('KeyD', true),
  },
  {
    id: 'browser.reload',
    group: 'workspace',
    labelKey: 'shortcuts.command.reloadBrowser',
    descriptionKey: 'shortcuts.command.reloadBrowserDescription',
    defaultBindings: primaryBinding('KeyR'),
  },
  {
    id: 'browser.hardReload',
    group: 'workspace',
    labelKey: 'shortcuts.command.hardReloadBrowser',
    descriptionKey: 'shortcuts.command.hardReloadBrowserDescription',
    defaultBindings: primaryBinding('KeyR', true),
  },
];

const commandById = new Map(keyboardShortcutCommands.map((command) => [command.id, command]));

export function keyboardShortcutCommand(
  commandId: KeyboardShortcutCommandId,
): KeyboardShortcutCommand {
  return commandById.get(commandId) as KeyboardShortcutCommand;
}

export function isKeyboardShortcutCommandId(value: unknown): value is KeyboardShortcutCommandId {
  return typeof value === 'string' && commandById.has(value as KeyboardShortcutCommandId);
}

export function keyboardShortcutPlatform(value: string | null | undefined): KeyboardShortcutPlatform {
  if (value === 'darwin' || value === 'linux' || value === 'win32') return value;
  return 'win32';
}

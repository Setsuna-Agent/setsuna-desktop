import type { MenuItem } from '@setsuna-desktop/renderer-ui';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
import { normalizeChatThinkingSelection, type ChatThinkingConfig, type ChatThinkingSelection } from './chatComposerModeState.js';

export type ChatThinkingControl = ChatThinkingSelection & {
  config: ChatThinkingConfig;
  disabled: boolean;
  onEffortChange: (effort: string) => void;
  onEnabledChange: (enabled: boolean) => void;
};

export function createChatThinkingMenu(control: ChatThinkingControl, t: Translate) {
  if (!control.config.supported) return null;
  const selection = normalizeChatThinkingSelection(control, control.config);
  const label = selection.enabled
    ? selection.effort ? formatThinkingEffort(selection.effort) : t('chat.composer.thinkingOn')
    : t('chat.composer.thinkingOff');
  const items: MenuItem[] = [
    {
      key: 'thinking:off',
      label: t('chat.composer.thinkingOff'),
      disabled: control.disabled,
      onClick: () => control.onEnabledChange(false),
    },
    ...control.config.efforts.map((effort) => ({
      key: `thinking:effort:${effort}`,
      label: formatThinkingEffort(effort),
      disabled: control.disabled,
      onClick: () => {
        control.onEffortChange(effort);
        control.onEnabledChange(true);
      },
    })),
  ];
  if (!control.config.efforts.length) items.push({
    key: 'thinking:on',
    label: t('chat.composer.thinkingOn'),
    disabled: control.disabled,
    onClick: () => control.onEnabledChange(true),
  });

  return {
    label,
    selectedKey: selection.enabled
      ? selection.effort ? `thinking:effort:${selection.effort}` : 'thinking:on'
      : 'thinking:off',
    items,
  };
}

function formatThinkingEffort(effort: string): string {
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

import type { RuntimePluginAppReference } from '@setsuna-desktop/contracts';
import { PresetAvatar } from '../../../shared/ui/icon-avatars/PresetAvatar.js';
import { usePluginAppAppearance } from '../../../kernel/declarative-plugin-ui/app-appearance/usePluginAppAppearance.js';
import { ChatInlineReference } from './ChatInlineReference.js';

export function PluginAppReferenceLabel({ app }: { app: RuntimePluginAppReference }) {
  const { appearance } = usePluginAppAppearance(app.pluginId, app.contributionId);
  const name = appearance.name ?? app.name;
  return <ChatInlineReference label={name} title={name}
    icon={<PresetAvatar avatar={appearance.avatar} color={appearance.avatarColor} variant="inline" />} />;
}

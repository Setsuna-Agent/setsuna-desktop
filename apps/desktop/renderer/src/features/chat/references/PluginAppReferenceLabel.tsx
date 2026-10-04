import type { RuntimePluginAppReference } from '@setsuna-desktop/contracts';
import { PluginAppAvatar } from '../../../kernel/declarative-plugin-ui/app-appearance/PluginAppAvatar.js';
import { usePluginAppAppearance } from '../../../kernel/declarative-plugin-ui/app-appearance/usePluginAppAppearance.js';
import { ChatInlineReference } from './ChatInlineReference.js';

export function PluginAppReferenceLabel({ app }: { app: RuntimePluginAppReference }) {
  const { appearance } = usePluginAppAppearance(app.pluginId, app.contributionId);
  const name = appearance.name ?? app.name;
  return <ChatInlineReference label={name} title={name}
    icon={<PluginAppAvatar avatar={appearance.avatar} variant="inline" />} />;
}

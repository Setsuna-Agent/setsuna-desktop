import { parsePluginMentions, type RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { createContext, Fragment, useContext, type ReactNode } from 'react';
import { PluginIcon } from '../../../shared/ui/PluginIcon.js';
import { WorkspaceMentionText } from '../mentions/WorkspaceMentionText.js';
import { ChatInlineReference } from './ChatInlineReference.js';

const PluginCatalog = createContext<readonly RuntimePluginSummary[]>([]);

export function PluginReferenceCatalogProvider({ plugins, children }: { plugins: readonly RuntimePluginSummary[]; children: ReactNode }) {
  return <PluginCatalog.Provider value={plugins}>{children}</PluginCatalog.Provider>;
}

export function PluginReferenceLabel({ plugin, label }: { plugin?: RuntimePluginSummary; label: string }) {
  return (
    <ChatInlineReference
      className="chat-plugin-reference"
      label={label}
      title={plugin?.description ?? plugin?.id ?? label}
      icon={<PluginIcon name={plugin?.icon} iconImage={plugin?.iconImage} pluginId={plugin?.id} variant="inline" />}
    />
  );
}

export function PluginReferenceText({ content }: { content: string }) {
  const plugins = useContext(PluginCatalog);
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const mention of parsePluginMentions(content)) {
    parts.push(<WorkspaceMentionText key={`text:${offset}`} content={content.slice(offset, mention.start)} />);
    const plugin = plugins.find((item) => item.id === mention.pluginId);
    parts.push(<PluginReferenceLabel key={`plugin:${mention.start}`} plugin={plugin} label={plugin?.name ?? mention.label} />);
    offset = mention.end;
  }
  parts.push(<WorkspaceMentionText key={`text:${offset}`} content={content.slice(offset)} />);
  return <Fragment>{parts}</Fragment>;
}

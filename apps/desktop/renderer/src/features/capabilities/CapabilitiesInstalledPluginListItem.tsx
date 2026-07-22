import type { RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';

export function CapabilitiesInstalledPluginListItem({
  onOpen,
  plugin,
}: {
  onOpen: (plugin: RuntimePluginSummary) => void;
  plugin: RuntimePluginSummary;
}) {
  return (
    <article className="desktop-plugin-list-item">
      <button className="desktop-plugin-list-item__identity" type="button" onClick={() => onOpen(plugin)}>
        <CapabilitiesPluginIcon name={plugin.icon} variant="list" />
        <span className="desktop-plugin-list-item__copy">
          <strong>{plugin.name}</strong>
          <span>{plugin.description || '已安装的本地 Setsuna 插件。'}</span>
          <small>{plugin.publisher || '本地来源'} · 已安装</small>
        </span>
      </button>
      <button className="desktop-plugin-market__get" type="button" onClick={() => onOpen(plugin)}>
        查看
      </button>
    </article>
  );
}

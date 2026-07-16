import { ChevronRight, Loader2, Trash2 } from 'lucide-react';
import type { RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { Button } from '../primitives.js';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';

export function CapabilitiesPluginCard({
  plugin,
  removing,
  onOpen,
  onRemove,
}: {
  plugin: RuntimePluginSummary;
  removing: boolean;
  onOpen: (plugin: RuntimePluginSummary) => void;
  onRemove: (plugin: RuntimePluginSummary) => Promise<void>;
}) {
  return (
    <article className="desktop-capability-card desktop-capability-card--plugin">
      <div className="desktop-capability-card__head">
        <span className="desktop-capability-card__head-main">
          <CapabilitiesPluginIcon name={plugin.icon} />
          <span className="desktop-capability-card__status is-on">已安装</span>
        </span>
        {plugin.version ? <span className="desktop-capability-card__status">v{plugin.version}</span> : null}
      </div>
      <h2>{plugin.name}</h2>
      <p>{plugin.description || '已安装的 Setsuna 插件。'}</p>
      {plugin.publisher || plugin.tags?.length ? (
        <div className="desktop-capability-card__meta">
          {plugin.publisher ? <span>{plugin.publisher}</span> : null}
          {plugin.tags?.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      ) : null}
      <div className="desktop-capability-card__tool-policy">
        {plugin.skills.length ? <span>{plugin.skills.length} 个技能</span> : null}
        {plugin.mcpServers.length ? <span>{plugin.mcpServers.length} 个服务连接</span> : null}
        {plugin.hookCount ? <span>{plugin.hookCount} 项自动化</span> : null}
        {plugin.resources.length ? <span>{plugin.resources.length} 个资源</span> : null}
      </div>
      <div className="desktop-capability-card__actions">
        <Button type="button" variant="ghost" icon={<ChevronRight size={14} />} onClick={() => onOpen(plugin)}>
          查看详情
        </Button>
        <Button
          type="button"
          variant="danger"
          icon={removing ? <Loader2 size={14} className="is-spinning" /> : <Trash2 size={14} />}
          disabled={removing}
          onClick={() => void onRemove(plugin)}
        >
          {removing ? '卸载中' : '卸载'}
        </Button>
      </div>
    </article>
  );
}

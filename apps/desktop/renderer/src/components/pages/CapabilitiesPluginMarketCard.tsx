import { Boxes, Check, Download, Loader2 } from 'lucide-react';
import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { Button } from '../primitives.js';

export function CapabilitiesPluginMarketCard({
  installing,
  onInstall,
  plugin,
}: {
  installing: boolean;
  onInstall: (plugin: RuntimePluginMarketplaceItem) => Promise<void>;
  plugin: RuntimePluginMarketplaceItem;
}) {
  return (
    <article className="desktop-capability-card desktop-capability-card--plugin desktop-capability-card--plugin-market">
      <div className="desktop-capability-card__head">
        <span className="desktop-capability-card__head-main">
          <span className="desktop-capability-card__icon"><Boxes size={14} /></span>
          <span className="desktop-capability-card__status">{plugin.featured ? '精选' : '插件'}</span>
        </span>
        {plugin.version ? <span className="desktop-capability-card__status">v{plugin.version}</span> : null}
      </div>
      <h2>{plugin.name}</h2>
      <p>{plugin.description || '为 Setsuna 添加新的技能和服务能力。'}</p>
      {plugin.publisher || plugin.tags.length ? (
        <div className="desktop-capability-card__meta">
          {plugin.publisher ? <span>{plugin.publisher}</span> : null}
          {plugin.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      ) : null}
      <div className="desktop-capability-card__tool-policy">
        {plugin.capabilities.skills ? <span>{plugin.capabilities.skills} 个技能</span> : null}
        {plugin.capabilities.mcpServers ? <span>{plugin.capabilities.mcpServers} 个服务连接</span> : null}
        {plugin.capabilities.hooks ? <span>{plugin.capabilities.hooks} 项自动化</span> : null}
        {plugin.capabilities.resources ? <span>{plugin.capabilities.resources} 个资源</span> : null}
      </div>
      <div className="desktop-capability-card__actions">
        <Button
          type="button"
          variant={plugin.installed ? 'ghost' : 'primary'}
          icon={plugin.installed
            ? <Check size={14} />
            : installing
              ? <Loader2 size={14} className="is-spinning" />
              : <Download size={14} />}
          disabled={plugin.installed || installing}
          onClick={() => void onInstall(plugin)}
        >
          {plugin.installed ? '已安装' : installing ? '安装中' : '安装'}
        </Button>
      </div>
    </article>
  );
}

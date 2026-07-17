import { BookOpen, Check, Download, FileText, Loader2, Plug, Trash2, Workflow } from 'lucide-react';
import type {
  RuntimePluginMarketplaceItem,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import { Button, PageHeader } from '../primitives.js';
import { CapabilitiesPluginDetailSection } from './CapabilitiesPluginDetailSection.js';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';
import { mergePluginHooks, mergePluginMcpServers, mergePluginSkills } from './pluginDisplay.js';

export function CapabilitiesPluginDetail({
  error,
  installedPlugin,
  installing,
  marketplacePlugin,
  onBack,
  onInstall,
  onRemove,
  removing,
}: {
  error: string | null;
  installedPlugin?: RuntimePluginSummary;
  installing: boolean;
  marketplacePlugin?: RuntimePluginMarketplaceItem;
  onBack: () => void;
  onInstall: (plugin: RuntimePluginMarketplaceItem) => Promise<void>;
  onRemove: (plugin: RuntimePluginSummary) => Promise<void>;
  removing: boolean;
}) {
  const plugin = installedPlugin ?? marketplacePlugin;
  if (!plugin) return null;

  const skills = mergePluginSkills(marketplacePlugin?.skills ?? [], installedPlugin?.skills ?? []);
  const mcpServers = mergePluginMcpServers(marketplacePlugin?.mcpServers ?? [], installedPlugin?.mcpServers ?? []);
  const hooks = mergePluginHooks(marketplacePlugin?.hooks ?? [], installedPlugin?.hooks ?? []);
  const hookCount = Math.max(hooks.length, installedPlugin?.hookCount ?? marketplacePlugin?.capabilities.hooks ?? 0);
  const resourceCount = installedPlugin?.resources.length ?? marketplacePlugin?.capabilities.resources ?? 0;
  const installed = Boolean(installedPlugin ?? marketplacePlugin?.installed);
  const subtitle = [plugin.publisher, plugin.version ? `v${plugin.version}` : null].filter(Boolean).join(' · ') || 'Setsuna 插件';
  const tags = plugin.tags ?? [];

  return (
    <section className="desktop-capabilities-detail desktop-capabilities-plugin-detail">
      <PageHeader
        title={plugin.name}
        subtitle={subtitle}
        backLabel="返回插件"
        onBack={onBack}
        actions={installedPlugin ? (
          <Button
            type="button"
            variant="danger"
            icon={removing ? <Loader2 className="is-spinning" size={14} /> : <Trash2 size={14} />}
            disabled={removing}
            onClick={() => void onRemove(installedPlugin)}
          >
            {removing ? '卸载中' : '卸载'}
          </Button>
        ) : marketplacePlugin && !installed ? (
          <Button
            type="button"
            variant="primary"
            icon={installing ? <Loader2 className="is-spinning" size={14} /> : <Download size={14} />}
            disabled={installing}
            onClick={() => void onInstall(marketplacePlugin)}
          >
            {installing ? '安装中' : '安装插件'}
          </Button>
        ) : (
          <Button type="button" variant="ghost" icon={<Check size={14} />} disabled>
            已安装
          </Button>
        )}
      />

      <div className="desktop-capabilities-plugin-detail__hero">
        <CapabilitiesPluginIcon name={marketplacePlugin?.icon ?? installedPlugin?.icon} variant="detail" />
        <div className="desktop-capabilities-plugin-detail__intro">
          <div className="desktop-capabilities-plugin-detail__badges">
            <span className={installed ? 'is-installed' : ''}>{installed ? '已安装' : '可安装'}</span>
            {marketplacePlugin?.featured ? <span>精选</span> : null}
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <p>{plugin.description || '为 Setsuna 添加新的技能、服务连接和自动化能力。'}</p>
          <small>安装后可在技能、MCP 和 Hooks 分区继续查看与管理插件提供的能力。</small>
        </div>
      </div>

      <dl className="desktop-capabilities-plugin-detail__stats">
        <div><dt>技能</dt><dd>{skills.length}</dd></div>
        <div><dt>MCP 服务</dt><dd>{mcpServers.length}</dd></div>
        <div><dt>自动化</dt><dd>{hookCount}</dd></div>
        <div><dt>资源</dt><dd>{resourceCount}</dd></div>
      </dl>

      <CapabilitiesPluginDetailSection
        icon={<BookOpen size={15} />}
        title="技能"
        count={skills.length}
        empty="这个插件不包含技能。"
      >
        {skills.map((skill) => (
          <article className="desktop-capabilities-plugin-detail__item" key={skill.id}>
            <span className="desktop-capabilities-plugin-detail__item-icon"><BookOpen size={16} /></span>
            <div className="desktop-capabilities-plugin-detail__item-body">
              <h4>{skill.name}</h4>
              <p>{skill.description || '插件提供的只读 Skill，安装后可在技能页启用或选择。'}</p>
            </div>
            <code>{skill.id}</code>
          </article>
        ))}
      </CapabilitiesPluginDetailSection>

      <CapabilitiesPluginDetailSection
        icon={<Plug size={15} />}
        title="MCP 服务"
        count={mcpServers.length}
        empty="这个插件不包含 MCP 服务。"
      >
        {mcpServers.map((server) => (
          <article className="desktop-capabilities-plugin-detail__item" key={server.key}>
            <span className="desktop-capabilities-plugin-detail__item-icon"><Plug size={16} /></span>
            <div className="desktop-capabilities-plugin-detail__item-body">
              <h4>{server.label}</h4>
              <p>{server.description || '插件声明的 MCP 服务，安装后仍遵循 Setsuna 的授权与信任策略。'}</p>
            </div>
            <div className="desktop-capabilities-plugin-detail__item-meta">
              <span>{server.transport === 'streamableHttp' ? '远程 MCP' : '本地 MCP'}</span>
              {server.owned === false ? <span>复用现有配置</span> : null}
              <code>{server.key}</code>
            </div>
          </article>
        ))}
      </CapabilitiesPluginDetailSection>

      <CapabilitiesPluginDetailSection
        icon={<Workflow size={15} />}
        title="Hooks"
        count={hooks.length}
        empty="这个插件不包含 Hook。"
      >
        {hooks.map((hook) => (
          <article className="desktop-capabilities-plugin-detail__item" key={hook.id}>
            <span className="desktop-capabilities-plugin-detail__item-icon"><Workflow size={16} /></span>
            <div className="desktop-capabilities-plugin-detail__item-body">
              <h4>{hook.name}</h4>
              <p>{hook.description || hook.statusMessage || '插件提供的本地自动化，安装后仍需信任当前命令 hash 才会执行。'}</p>
            </div>
            <div className="desktop-capabilities-plugin-detail__item-meta">
              <span>{hook.eventName}</span>
              {hook.matcher ? <span>{hook.matcher}</span> : null}
              <code>{hook.id}</code>
            </div>
          </article>
        ))}
      </CapabilitiesPluginDetailSection>

      {(hookCount > hooks.length || resourceCount) ? (
        <section className="desktop-capabilities-plugin-detail__extras" aria-label="其他插件内容">
          {hookCount > hooks.length ? (
            <div>
              <Workflow size={16} />
              <span><strong>{hookCount} 项自动化</strong><small>旧版安装记录未保存详情，可在 Hooks 分区查看。</small></span>
            </div>
          ) : null}
          {resourceCount ? (
            <div>
              <FileText size={16} />
              <span><strong>{resourceCount} 个资源</strong><small>供插件技能在执行任务时按需读取。</small></span>
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? <div className="desktop-capabilities-errors" role="alert">{error}</div> : null}
    </section>
  );
}

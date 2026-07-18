import { useState } from 'react';
import { BookOpen, Check, Download, FileText, Loader2, Plug, Trash2, Workflow } from 'lucide-react';
import type {
  RuntimeHookMetadata,
  RuntimeImageGenerationConfigInput,
  RuntimeImageGenerationConfigState,
  RuntimeImageGenerationTestInput,
  RuntimeImageGenerationTestResult,
  RuntimeMcpServer,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginMarketplaceItem,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';
import { OPENAI_IMAGE_GENERATION_PLUGIN_ID } from '@setsuna-desktop/contracts';
import { Button, PageHeader } from '../primitives.js';
import { CapabilitiesPluginDetailSection } from './CapabilitiesPluginDetailSection.js';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';
import { CapabilitiesPluginItemButton } from './CapabilitiesPluginItemButton.js';
import { CapabilitiesPluginItemDialog, type CapabilitiesPluginItem } from './CapabilitiesPluginItemDialog.js';
import { ImageGenerationPluginSettings } from './ImageGenerationPluginSettings.js';
import { formatPluginFileSize, mergePluginHooks, mergePluginMcpServers, mergePluginSkills } from './pluginDisplay.js';

export function CapabilitiesPluginDetail({
  error,
  imageGenerationConfig,
  installedPlugin,
  installing,
  marketplacePlugin,
  runtimeMcpServers,
  onBack,
  onGetItemContent,
  onInstall,
  onRemove,
  onSaveImageGenerationConfig,
  onTestImageGeneration,
  removing,
  runtimeHooks,
}: {
  error: string | null;
  imageGenerationConfig?: RuntimeImageGenerationConfigState;
  installedPlugin?: RuntimePluginSummary;
  installing: boolean;
  marketplacePlugin?: RuntimePluginMarketplaceItem;
  runtimeMcpServers?: RuntimeMcpServer[];
  onBack: () => void;
  onGetItemContent?: (kind: RuntimePluginItemKind, itemId: string) => Promise<RuntimePluginItemContent>;
  onInstall: (plugin: RuntimePluginMarketplaceItem) => Promise<void>;
  onRemove: (plugin: RuntimePluginSummary) => Promise<void>;
  onSaveImageGenerationConfig?: (input: RuntimeImageGenerationConfigInput) => Promise<void>;
  onTestImageGeneration?: (input: RuntimeImageGenerationTestInput) => Promise<RuntimeImageGenerationTestResult>;
  removing: boolean;
  runtimeHooks?: RuntimeHookMetadata[];
}) {
  const [selectedItem, setSelectedItem] = useState<CapabilitiesPluginItem | null>(null);
  const plugin = installedPlugin ?? marketplacePlugin;
  if (!plugin) return null;

  const skills = mergePluginSkills(marketplacePlugin?.skills ?? [], installedPlugin?.skills ?? []);
  const mcpServers = mergePluginMcpServers(marketplacePlugin?.mcpServers ?? [], installedPlugin?.mcpServers ?? []);
  const hooks = mergePluginHooks(marketplacePlugin?.hooks ?? [], installedPlugin?.hooks ?? []);
  const resources = installedPlugin?.resources.length ? installedPlugin.resources : marketplacePlugin?.resources ?? [];
  const hookCount = Math.max(hooks.length, installedPlugin?.hookCount ?? marketplacePlugin?.capabilities.hooks ?? 0);
  const resourceCount = Math.max(resources.length, marketplacePlugin?.capabilities.resources ?? 0);
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
          <>
            {marketplacePlugin?.updateAvailable ? (
              <Button
                type="button"
                variant="primary"
                icon={installing ? <Loader2 className="is-spinning" size={14} /> : <Download size={14} />}
                disabled={installing || removing}
                onClick={() => void onInstall(marketplacePlugin)}
              >
                {installing ? '更新中' : marketplacePlugin.version ? `更新到 v${marketplacePlugin.version}` : '更新插件'}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="danger"
              icon={removing ? <Loader2 className="is-spinning" size={14} /> : <Trash2 size={14} />}
              disabled={installing || removing}
              onClick={() => void onRemove(installedPlugin)}
            >
              {removing ? '卸载中' : '卸载'}
            </Button>
          </>
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

      {error ? <div className="desktop-capabilities-errors" role="alert">{error}</div> : null}

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

      {installed
        && plugin.id === OPENAI_IMAGE_GENERATION_PLUGIN_ID
        && onSaveImageGenerationConfig
        && onTestImageGeneration ? (
        <ImageGenerationPluginSettings
          config={imageGenerationConfig}
          onSave={onSaveImageGenerationConfig}
          onTest={onTestImageGeneration}
        />
      ) : null}

      <CapabilitiesPluginDetailSection
        icon={<BookOpen size={15} />}
        title="技能"
        count={skills.length}
        empty="这个插件不包含技能。"
      >
        {skills.map((skill) => (
          <CapabilitiesPluginItemButton
            key={skill.id}
            title={skill.name}
            description={skill.description || '插件提供的只读 Skill，安装后可在技能页启用或选择。'}
            icon={<BookOpen size={16} />}
            onClick={() => setSelectedItem({ kind: 'skill', value: skill })}
          />
        ))}
      </CapabilitiesPluginDetailSection>

      <CapabilitiesPluginDetailSection
        icon={<Plug size={15} />}
        title="MCP 服务"
        count={mcpServers.length}
        empty="这个插件不包含 MCP 服务。"
      >
        {mcpServers.map((server) => (
          <CapabilitiesPluginItemButton
            key={server.key}
            title={server.label}
            description={server.description || '插件声明的 MCP 服务，安装后仍遵循 Setsuna 的授权与信任策略。'}
            icon={<Plug size={16} />}
            badges={[
              server.transport === 'streamableHttp' ? '远程 MCP' : '本地 MCP',
              ...(server.owned === false ? ['复用现有配置'] : []),
            ]}
            onClick={() => setSelectedItem({ kind: 'mcp', value: server })}
          />
        ))}
      </CapabilitiesPluginDetailSection>

      <CapabilitiesPluginDetailSection
        icon={<Workflow size={15} />}
        title="Hooks"
        count={hookCount}
        empty="这个插件不包含 Hook。"
      >
        {hooks.map((hook) => (
          <CapabilitiesPluginItemButton
            key={hook.id}
            title={hook.name}
            description={hook.description || hook.statusMessage || (marketplacePlugin
              ? '应用内置自动化，安装插件时会自动信任当前命令 hash。'
              : '本地插件自动化，安装后仍需信任当前命令 hash 才会执行。')}
            icon={<Workflow size={16} />}
            onClick={() => setSelectedItem({ kind: 'hook', value: hook })}
          />
        ))}
        {hookCount > hooks.length ? (
          <p className="desktop-capabilities-plugin-detail__empty">另有 {hookCount - hooks.length} 项旧版自动化未保存展示详情，可在 Hooks 分区查看。</p>
        ) : null}
      </CapabilitiesPluginDetailSection>

      <CapabilitiesPluginDetailSection
        icon={<FileText size={15} />}
        title="资源"
        count={resourceCount}
        empty="这个插件不包含资源。"
      >
        {resources.map((resource) => (
          <CapabilitiesPluginItemButton
            key={resource.id}
            title={resource.label}
            description={resource.path}
            icon={<FileText size={16} />}
            badges={[formatPluginFileSize(resource.size)]}
            onClick={() => setSelectedItem({ kind: 'resource', value: resource })}
          />
        ))}
        {resourceCount > resources.length ? (
          <p className="desktop-capabilities-plugin-detail__empty">安装插件后可查看 {resourceCount} 个资源的文件详情。</p>
        ) : null}
      </CapabilitiesPluginDetailSection>

      {selectedItem ? (
        <CapabilitiesPluginItemDialog
          key={`${selectedItem.kind}:${selectedItem.kind === 'mcp' ? selectedItem.value.key : selectedItem.value.id}`}
          item={selectedItem}
          mcpServers={runtimeMcpServers ?? []}
          pluginId={plugin.id}
          runtimeHooks={runtimeHooks ?? []}
          trustHooksOnInstall={Boolean(marketplacePlugin)}
          onClose={() => setSelectedItem(null)}
          onGetContent={onGetItemContent}
        />
      ) : null}
    </section>
  );
}

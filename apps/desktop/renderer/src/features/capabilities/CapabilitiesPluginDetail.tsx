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
import { BookOpen, Check, Download, FileText, Loader2, Plug, Trash2, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { Button, PageHeader } from '../../shared/ui/primitives.js';
import { CapabilitiesPluginDetailSection } from './CapabilitiesPluginDetailSection.js';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';
import { CapabilitiesPluginItemButton } from './CapabilitiesPluginItemButton.js';
import { CapabilitiesPluginItemDialog, type CapabilitiesPluginItem } from './CapabilitiesPluginItemDialog.js';
import { ImageGenerationPluginSettings } from './ImageGenerationPluginSettings.js';
import { formatPluginFileSize, mergePluginHooks, mergePluginMcpServers, mergePluginSkills } from './pluginDisplay.js';
import { localizedPluginCopy } from './pluginLocalization.js';

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
  const { t } = useI18n();
  const [selectedItem, setSelectedItem] = useState<CapabilitiesPluginItem | null>(null);
  const plugin = installedPlugin ?? marketplacePlugin;
  if (!plugin) return null;
  const copy = localizedPluginCopy(plugin, t);

  const skills = mergePluginSkills(marketplacePlugin?.skills ?? [], installedPlugin?.skills ?? []);
  const mcpServers = mergePluginMcpServers(marketplacePlugin?.mcpServers ?? [], installedPlugin?.mcpServers ?? []);
  const hooks = mergePluginHooks(marketplacePlugin?.hooks ?? [], installedPlugin?.hooks ?? []);
  const resources = installedPlugin?.resources.length ? installedPlugin.resources : marketplacePlugin?.resources ?? [];
  const hookCount = Math.max(hooks.length, installedPlugin?.hookCount ?? marketplacePlugin?.capabilities.hooks ?? 0);
  const resourceCount = Math.max(resources.length, marketplacePlugin?.capabilities.resources ?? 0);
  const installed = Boolean(installedPlugin ?? marketplacePlugin?.installed);
  const subtitle = [plugin.publisher, plugin.version ? `v${plugin.version}` : null].filter(Boolean).join(' · ') || t('capabilities.market.pluginSummary');
  const tags = plugin.tags ?? [];

  return (
    <section className="desktop-capabilities-detail desktop-capabilities-plugin-detail">
      <PageHeader
        title={copy.name}
        subtitle={subtitle}
        backLabel={t('capabilities.detail.back')}
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
                {installing
                  ? t('capabilities.market.updating')
                  : marketplacePlugin.version
                    ? t('capabilities.detail.updateTo', { version: marketplacePlugin.version })
                    : t('capabilities.detail.updatePlugin')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="danger"
              icon={removing ? <Loader2 className="is-spinning" size={14} /> : <Trash2 size={14} />}
              disabled={installing || removing}
              onClick={() => void onRemove(installedPlugin)}
            >
              {t(removing ? 'capabilities.detail.uninstalling' : 'capabilities.detail.uninstall')}
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
            {t(installing ? 'capabilities.detail.installing' : 'capabilities.detail.install')}
          </Button>
        ) : (
          <Button type="button" variant="ghost" icon={<Check size={14} />} disabled>
            {t('capabilities.market.installed')}
          </Button>
        )}
      />

      {error ? <div className="desktop-capabilities-errors" role="alert">{error}</div> : null}

      <div className="desktop-capabilities-plugin-detail__hero">
        <CapabilitiesPluginIcon name={marketplacePlugin?.icon ?? installedPlugin?.icon} variant="detail" />
        <div className="desktop-capabilities-plugin-detail__intro">
          <div className="desktop-capabilities-plugin-detail__badges">
            <span className={installed ? 'is-installed' : ''}>{t(installed ? 'capabilities.market.installed' : 'capabilities.detail.available')}</span>
            {marketplacePlugin?.featured ? <span>{t('capabilities.detail.featured')}</span> : null}
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <p>{copy.description || t('capabilities.market.listFallback')}</p>
          <small>{t('capabilities.detail.manageHint')}</small>
        </div>
      </div>

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
        title={t('capabilities.detail.skills')}
        count={skills.length}
        empty={t('capabilities.detail.skillsEmpty')}
      >
        {skills.map((skill) => (
          <CapabilitiesPluginItemButton
            key={skill.id}
            title={skill.name}
            description={skill.description || t('capabilities.detail.skillFallback')}
            icon={<BookOpen size={16} />}
            onClick={() => setSelectedItem({ kind: 'skill', value: skill })}
          />
        ))}
      </CapabilitiesPluginDetailSection>

      <CapabilitiesPluginDetailSection
        icon={<Plug size={15} />}
        title={t('capabilities.detail.mcp')}
        count={mcpServers.length}
        empty={t('capabilities.detail.mcpEmpty')}
      >
        {mcpServers.map((server) => (
          <CapabilitiesPluginItemButton
            key={server.key}
            title={server.label}
            description={server.description || t('capabilities.detail.mcpFallback')}
            icon={<Plug size={16} />}
            badges={[
              t(server.transport === 'streamableHttp' ? 'capabilities.detail.remoteMcp' : 'capabilities.detail.localMcp'),
              ...(server.owned === false ? [t('capabilities.detail.reuseExisting')] : []),
            ]}
            onClick={() => setSelectedItem({ kind: 'mcp', value: server })}
          />
        ))}
      </CapabilitiesPluginDetailSection>

      <CapabilitiesPluginDetailSection
        icon={<Workflow size={15} />}
        title="Hooks"
        count={hookCount}
        empty={t('capabilities.detail.hooksEmpty')}
      >
        {hooks.map((hook) => (
          <CapabilitiesPluginItemButton
            key={hook.id}
            title={hook.name}
            description={hook.description || hook.statusMessage || (marketplacePlugin
              ? t('capabilities.detail.managedHookFallback')
              : t('capabilities.detail.localHookFallback'))}
            icon={<Workflow size={16} />}
            onClick={() => setSelectedItem({ kind: 'hook', value: hook })}
          />
        ))}
        {hookCount > hooks.length ? (
          <p className="desktop-capabilities-plugin-detail__empty">{t('capabilities.detail.legacyHooks', { count: hookCount - hooks.length })}</p>
        ) : null}
      </CapabilitiesPluginDetailSection>

      <CapabilitiesPluginDetailSection
        icon={<FileText size={15} />}
        title={t('capabilities.detail.resources')}
        count={resourceCount}
        empty={t('capabilities.detail.resourcesEmpty')}
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
          <p className="desktop-capabilities-plugin-detail__empty">{t('capabilities.detail.resourcesAfterInstall', { count: resourceCount })}</p>
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

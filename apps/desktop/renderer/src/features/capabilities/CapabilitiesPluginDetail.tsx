import type {
  RuntimeConfigState,
  RuntimeExtensionStatus,
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
  RuntimeSkillDetail,
  RuntimeSkillSummary,
  RuntimeVisionRecognitionConfigInput,
  RuntimeVisionRecognitionTestInput,
  RuntimeVisionRecognitionTestResult,
} from '@setsuna-desktop/contracts';
import {
  OPENAI_IMAGE_GENERATION_PLUGIN_ID,
  OPENAI_VISION_RECOGNITION_PLUGIN_ID,
} from '@setsuna-desktop/contracts';
import { Dropdown, type MenuProps } from 'antd';
import { AlertTriangle, BookOpen, Check, Download, FileText, Loader2, MessageSquare, MoreHorizontal, Plug, ShieldCheck, ShieldOff, Trash2, Workflow, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { Button, IconButton, PageHeader } from '../../shared/ui/primitives.js';
import { CapabilitiesPluginDetailSection } from './CapabilitiesPluginDetailSection.js';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';
import { CapabilitiesPluginItemButton } from './CapabilitiesPluginItemButton.js';
import { CapabilitiesPluginItemDialog, type CapabilitiesPluginItem } from './CapabilitiesPluginItemDialog.js';
import { CapabilitiesPluginSkillItem } from './CapabilitiesPluginSkillItem.js';
import { ImageGenerationPluginSettings } from './ImageGenerationPluginSettings.js';
import { VisionRecognitionPluginSettings } from './VisionRecognitionPluginSettings.js';
import { formatPluginFileSize, mergePluginHooks, mergePluginMcpServers, mergePluginSkills, mergePluginTools } from './pluginDisplay.js';
import { localizedPluginCopy } from './pluginLocalization.js';

export function CapabilitiesPluginDetail({
  error,
  extensionStatus,
  extensionTrusting = false,
  imageGenerationConfig,
  runtimeConfig,
  installedPlugin,
  installing,
  marketplacePlugin,
  runtimeMcpServers,
  runtimeSkills,
  onBack,
  onGetItemContent,
  onGetSkillDetail,
  onInstall,
  onRemove,
  onUseInConversation,
  onSetExtensionTrust,
  onSetHookEnabled,
  onSetHookTrust,
  onSetSkillEnabled,
  onSaveImageGenerationConfig,
  onTestImageGeneration,
  onSaveVisionRecognitionConfig,
  onTestVisionRecognition,
  removing,
  runtimeHooks,
}: {
  error: string | null;
  extensionStatus?: RuntimeExtensionStatus;
  extensionTrusting?: boolean;
  imageGenerationConfig?: RuntimeImageGenerationConfigState;
  runtimeConfig?: RuntimeConfigState;
  installedPlugin?: RuntimePluginSummary;
  installing: boolean;
  marketplacePlugin?: RuntimePluginMarketplaceItem;
  runtimeMcpServers?: RuntimeMcpServer[];
  runtimeSkills?: RuntimeSkillSummary[];
  onBack: () => void;
  onGetItemContent?: (kind: RuntimePluginItemKind, itemId: string) => Promise<RuntimePluginItemContent>;
  onGetSkillDetail?: (skillId: string) => Promise<RuntimeSkillDetail>;
  onInstall: (plugin: RuntimePluginMarketplaceItem) => Promise<void>;
  onRemove: (plugin: RuntimePluginSummary) => Promise<void>;
  onUseInConversation?: (skillId: string) => void;
  onSetExtensionTrust?: (plugin: RuntimePluginSummary, trusted: boolean) => Promise<void>;
  onSetHookEnabled?: (hook: RuntimeHookMetadata, enabled: boolean) => Promise<void>;
  onSetHookTrust?: (hook: RuntimeHookMetadata, trusted: boolean) => Promise<void>;
  onSetSkillEnabled?: (skill: RuntimeSkillSummary, enabled: boolean) => Promise<void>;
  onSaveImageGenerationConfig?: (input: RuntimeImageGenerationConfigInput) => Promise<void>;
  onTestImageGeneration?: (input: RuntimeImageGenerationTestInput) => Promise<RuntimeImageGenerationTestResult>;
  onSaveVisionRecognitionConfig?: (input: RuntimeVisionRecognitionConfigInput) => Promise<void>;
  onTestVisionRecognition?: (input: RuntimeVisionRecognitionTestInput) => Promise<RuntimeVisionRecognitionTestResult>;
  removing: boolean;
  runtimeHooks?: RuntimeHookMetadata[];
}) {
  const { t } = useI18n();
  const [selectedItem, setSelectedItem] = useState<CapabilitiesPluginItem | null>(null);
  const plugin = installedPlugin ?? marketplacePlugin;
  if (!plugin) return null;
  const marketplaceMetadata = marketplacePlugin
    && (!installedPlugin || installedPlugin.installationSource === 'marketplace')
    ? marketplacePlugin
    : undefined;
  const displayPlugin = marketplaceMetadata ?? plugin;
  const copy = localizedPluginCopy(displayPlugin, t);

  const includeCatalogOnly = !installedPlugin;
  const tools = mergePluginTools(marketplaceMetadata?.tools ?? [], installedPlugin?.tools ?? [], includeCatalogOnly);
  const skills = mergePluginSkills(marketplaceMetadata?.skills ?? [], installedPlugin?.skills ?? [], includeCatalogOnly);
  const runtimeSkillById = new Map((runtimeSkills ?? []).map((skill) => [skill.id, skill]));
  const conversationSkill = skills
    .map((skill) => runtimeSkillById.get(skill.id))
    .find((skill) => skill?.enabled);
  const mcpServers = mergePluginMcpServers(
    marketplaceMetadata?.mcpServers ?? [],
    installedPlugin?.mcpServers ?? [],
    includeCatalogOnly,
  );
  const hooks = mergePluginHooks(marketplaceMetadata?.hooks ?? [], installedPlugin?.hooks ?? [], includeCatalogOnly);
  const catalogResourceIds = new Set(marketplaceMetadata?.resources.map((resource) => resource.id) ?? []);
  // Installed details must remain readable. The catalog may remove old bundled
  // notices, but catalog-only additions are shown only after the user updates.
  const resources = installedPlugin
    ? installedPlugin.resources.filter((resource) => !marketplaceMetadata || catalogResourceIds.has(resource.id))
    : marketplaceMetadata?.resources ?? [];
  const hookCount = installedPlugin
    ? Math.max(hooks.length, installedPlugin.hookCount)
    : Math.max(hooks.length, marketplaceMetadata?.capabilities.hooks ?? 0);
  const resourceCount = installedPlugin
    ? resources.length
    : Math.max(resources.length, marketplaceMetadata?.capabilities.resources ?? 0);
  const installed = Boolean(installedPlugin ?? marketplaceMetadata?.installed);
  const installedFromMarketplace = installedPlugin?.installationSource === 'marketplace';
  const publisher = marketplaceMetadata?.publisher ?? plugin.publisher;
  const subtitle = [publisher, plugin.version ? `v${plugin.version}` : null].filter(Boolean).join(' · ') || t('capabilities.market.pluginSummary');
  const extension = installedPlugin?.extension ?? marketplaceMetadata?.extension;
  const isBundledExtension = Boolean(marketplaceMetadata);
  const installedExtensionTrust = installedPlugin?.extension?.trust;
  const localExtensionTrusted = !isBundledExtension && installedExtensionTrust === 'trusted';
  const bundledExtensionNeedsRepair = Boolean(
    isBundledExtension
      && installedPlugin?.extension
      && installedExtensionTrust !== 'trusted',
  );
  const extensionVerified = isBundledExtension
    ? !bundledExtensionNeedsRepair
    : localExtensionTrusted;
  const showExtensionStatus = Boolean(
    extension
      && (bundledExtensionNeedsRepair
        || (!isBundledExtension && installedPlugin?.extension)
        || extensionStatus?.state === 'failed'),
  );
  const actionItems: MenuProps['items'] = [
    ...(marketplaceMetadata?.updateAvailable ? [{
      key: 'update',
      disabled: installing || removing,
      icon: installing ? <Loader2 className="is-spinning" size={14} /> : <Download size={14} />,
      label: installing
        ? t('capabilities.market.updating')
        : marketplaceMetadata.version
          ? t('capabilities.detail.updateTo', { version: marketplaceMetadata.version })
          : t('capabilities.detail.updatePlugin'),
    }] : []),
    {
      key: 'uninstall',
      danger: true,
      disabled: installing || removing,
      icon: removing ? <Loader2 className="is-spinning" size={14} /> : <Trash2 size={14} />,
      label: t(removing ? 'capabilities.detail.uninstalling' : 'capabilities.detail.uninstall'),
    },
    {
      key: 'use-in-conversation',
      disabled: !conversationSkill || !onUseInConversation,
      icon: <MessageSquare size={14} />,
      label: t('capabilities.skill.useInConversation'),
    },
  ];
  const handleActionClick: NonNullable<MenuProps['onClick']> = ({ key }) => {
    if (key === 'update' && marketplaceMetadata) void onInstall(marketplaceMetadata);
    if (key === 'uninstall' && installedPlugin) void onRemove(installedPlugin);
    if (key === 'use-in-conversation' && conversationSkill) onUseInConversation?.(conversationSkill.id);
  };

  return (
    <section className="desktop-capabilities-detail desktop-capabilities-plugin-detail">
      <PageHeader
        className="desktop-capabilities-plugin-detail__header"
        leading={(
          <CapabilitiesPluginIcon
            name={marketplaceMetadata?.icon ?? installedPlugin?.icon}
            pluginId={marketplaceMetadata?.id ?? installedPlugin?.id}
            variant="list"
          />
        )}
        title={copy.name}
        subtitle={subtitle}
        backLabel={t('capabilities.detail.back')}
        onBack={onBack}
        actions={installedPlugin ? (
          <Dropdown
            destroyOnHidden
            menu={{ items: actionItems, onClick: handleActionClick }}
            placement="bottomRight"
            trigger={['click']}
          >
            <IconButton label={t('capabilities.skill.actions')}>
              <MoreHorizontal size={16} />
            </IconButton>
          </Dropdown>
        ) : marketplaceMetadata && !installed ? (
          <Button
            type="button"
            variant="primary"
            icon={installing ? <Loader2 className="is-spinning" size={14} /> : <Download size={14} />}
            disabled={installing}
            onClick={() => void onInstall(marketplaceMetadata)}
          >
            {t(installing ? 'capabilities.detail.installing' : 'capabilities.detail.install')}
          </Button>
        ) : (
          <Button type="button" variant="ghost" icon={<Check size={14} />} disabled>
            {t('capabilities.market.installed')}
          </Button>
        )}
      />

      <p className="desktop-capabilities-plugin-detail__description">
        {copy.description || t('capabilities.market.listFallback')}
      </p>

      {error ? <div className="desktop-capabilities-errors" role="alert">{error}</div> : null}

      {extension && showExtensionStatus ? (
        <section className="desktop-capabilities-plugin-detail__extension" aria-label={t('capabilities.extension.title')}>
          <div className="desktop-capabilities-plugin-detail__extension-copy">
            <span className={`desktop-capabilities-plugin-detail__extension-icon${extensionVerified ? ' is-trusted' : ''}`}>
              {extensionVerified
                ? <ShieldCheck size={19} aria-hidden="true" />
                : <AlertTriangle size={19} aria-hidden="true" />}
            </span>
            <div>
              <strong>{t('capabilities.extension.title')}</strong>
              <span>
                {isBundledExtension
                  ? t(bundledExtensionNeedsRepair
                    ? 'capabilities.extension.builtin.needsRepair'
                    : installedPlugin?.extension
                      ? 'capabilities.extension.builtin.active'
                      : 'capabilities.extension.builtin.available')
                  : t(`capabilities.extension.trust.${installedExtensionTrust ?? 'available'}`)}
              </span>
              <p>{t(isBundledExtension
                ? 'capabilities.extension.builtin.description'
                : 'capabilities.extension.warning')}</p>
              <small>
                {t('capabilities.extension.capabilities', { capabilities: extension.capabilities.join(' · ') })}
                {extensionStatus ? ` · ${t(`capabilities.extension.status.${extensionStatus.state}`)}` : ''}
              </small>
              {extensionStatus?.error ? <small className="is-error">{extensionStatus.error}</small> : null}
            </div>
          </div>
          {!isBundledExtension
            && installedPlugin?.extension
            && onSetExtensionTrust ? (
            <Button
              type="button"
              variant={localExtensionTrusted ? 'secondary' : 'primary'}
              icon={extensionTrusting
                ? <Loader2 className="is-spinning" size={14} />
                : localExtensionTrusted ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
              disabled={extensionTrusting || installing || removing}
              onClick={() => void onSetExtensionTrust(installedPlugin, !localExtensionTrusted)}
            >
              {t(extensionTrusting
                ? 'capabilities.extension.trusting'
                : localExtensionTrusted
                  ? 'capabilities.extension.revoke'
                  : 'capabilities.extension.trust')}
            </Button>
          ) : null}
        </section>
      ) : null}

      {installedFromMarketplace
        && plugin.id === OPENAI_IMAGE_GENERATION_PLUGIN_ID
        && onSaveImageGenerationConfig
        && onTestImageGeneration ? (
        <ImageGenerationPluginSettings
          config={imageGenerationConfig}
          onSave={onSaveImageGenerationConfig}
          onTest={onTestImageGeneration}
        />
      ) : null}

      {installedFromMarketplace
        && plugin.id === OPENAI_VISION_RECOGNITION_PLUGIN_ID
        && onSaveVisionRecognitionConfig
        && onTestVisionRecognition ? (
        <VisionRecognitionPluginSettings
          config={runtimeConfig}
          onSave={onSaveVisionRecognitionConfig}
          onTest={onTestVisionRecognition}
        />
      ) : null}

      <CapabilitiesPluginDetailSection
        icon={<Wrench size={15} />}
        title={t('capabilities.detail.tools')}
        count={tools.length}
        empty={t('capabilities.detail.toolsEmpty')}
      >
        {tools.map((tool) => (
          <CapabilitiesPluginItemButton
            key={tool.name}
            title={tool.name}
            description={tool.description || t('capabilities.detail.toolFallback')}
            icon={<Wrench size={16} />}
            badges={[t('capabilities.detail.runtimeTool')]}
          />
        ))}
      </CapabilitiesPluginDetailSection>

      <CapabilitiesPluginDetailSection
        icon={<BookOpen size={15} />}
        title={t('capabilities.detail.skills')}
        count={skills.length}
        empty={t('capabilities.detail.skillsEmpty')}
      >
        {skills.map((skill) => (
          installedPlugin ? (
            <CapabilitiesPluginSkillItem
              key={skill.id}
              runtimeSkill={runtimeSkillById.get(skill.id)}
              skill={skill}
              onOpen={() => setSelectedItem({ kind: 'skill', value: skill })}
              onSetEnabled={onSetSkillEnabled}
            />
          ) : (
            <CapabilitiesPluginItemButton
              key={skill.id}
              title={skill.name}
              description={skill.description || t('capabilities.detail.skillFallback')}
              icon={<BookOpen size={16} />}
              onClick={() => setSelectedItem({ kind: 'skill', value: skill })}
            />
          )
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
            description={hook.description || hook.statusMessage || (marketplaceMetadata
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

      {resourceCount > 0 ? (
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
      ) : null}

      {selectedItem ? (
        <CapabilitiesPluginItemDialog
          key={`${selectedItem.kind}:${selectedItem.kind === 'mcp' ? selectedItem.value.key : selectedItem.value.id}`}
          item={selectedItem}
          mcpServers={runtimeMcpServers ?? []}
          pluginId={plugin.id}
          runtimeHooks={runtimeHooks ?? []}
          trustHooksOnInstall={Boolean(marketplaceMetadata)}
          onSetHookEnabled={installedPlugin ? onSetHookEnabled : undefined}
          onSetHookTrust={installedPlugin && !marketplaceMetadata ? onSetHookTrust : undefined}
          onClose={() => setSelectedItem(null)}
          onGetContent={selectedItem.kind === 'skill' && installedPlugin && onGetSkillDetail
            ? (_kind, itemId) => runtimeSkillItemContent(plugin.id, itemId, onGetSkillDetail)
            : onGetItemContent}
        />
      ) : null}
    </section>
  );
}

async function runtimeSkillItemContent(
  pluginId: string,
  skillId: string,
  getSkillDetail: (skillId: string) => Promise<RuntimeSkillDetail>,
): Promise<RuntimePluginItemContent> {
  const detail = await getSkillDetail(skillId);
  return {
    pluginId,
    itemId: skillId,
    kind: 'skill',
    files: [{
      path: 'SKILL.md',
      size: new TextEncoder().encode(detail.content).byteLength,
      mimeType: 'text/markdown',
      text: detail.content,
    }],
  };
}

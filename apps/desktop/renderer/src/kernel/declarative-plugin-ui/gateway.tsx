import {
  parseRuntimePluginUiManifest,
  type RuntimePluginSummary,
  type RuntimePluginUiContribution,
  type RuntimePluginUiManifest,
  type RuntimePluginUiNode,
} from '@setsuna-desktop/contracts';
import { defineRendererPlugin, type RendererPluginDefinition } from '@setsuna-desktop/feature-core/renderer';
import type { Disposer } from '@setsuna-desktop/feature-core/scope';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { chatComposerStatusSlot } from '@setsuna-desktop/renderer-contracts/chat';
import {
  registerSettingsPage,
  registerSettingsPageExtension,
} from '@setsuna-desktop/renderer-contracts/settings';
import {
  rendererPluginViewKey,
  shellPluginPageSlot,
  shellSidebarPluginEntrySlot,
} from '@setsuna-desktop/renderer-contracts/shell';
import type { RendererPluginRuntime } from '../renderer-plugins/runtime.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { PluginIcon } from '../../shared/ui/PluginIcon.js';
import { DeclarativePluginUiView } from './DeclarativePluginUiView.js';
import { SandboxedPluginUiView } from './SandboxedPluginUiView.js';
import {
  resolveRuntimePluginUiText,
  useDeclarativePluginUiData,
} from './useDeclarativePluginUiData.js';

const SETTINGS_TARGET_ALLOWLIST = new Set(['about', 'general']);
const CHAT_NODE_ALLOWLIST = new Set<RuntimePluginUiNode['type']>([
  'badge',
  'button',
  'notice',
  'stack',
  'text',
]);

type ActiveUiPlugin = Readonly<{
  dispose: Disposer;
  signature: string;
}>;

/**
 * Bridges trusted Plugin manifest data into transactional Renderer mounts. The
 * controller owns subscription and cleanup; React components never register UI.
 */
export async function activateDeclarativePluginUiGateway(
  runtime: RendererPluginRuntime,
  service: PluginManagementRendererService,
): Promise<Disposer> {
  const active = new Map<string, ActiveUiPlugin>();
  let disposed = false;
  let tail: Promise<void> = Promise.resolve();

  const synchronize = async (): Promise<void> => {
    if (disposed) return;
    const snapshot = service.getSnapshot();
    const desired = desiredUiPlugins(snapshot.plugins, snapshot.catalogRevision, service);
    for (const [pluginId, current] of active) {
      if (desired.has(pluginId)) continue;
      active.delete(pluginId);
      await current.dispose();
    }
    for (const [pluginId, next] of desired) {
      const current = active.get(pluginId);
      if (current?.signature === next.signature) continue;
      try {
        const dispose = await runtime.mount(next.plugin);
        active.set(pluginId, Object.freeze({ dispose, signature: next.signature }));
        await current?.dispose();
      } catch {
        // One malformed or incompatible Plugin UI must not take down the app or
        // replace its last valid transactional mount.
        console.warn(`[DeclarativePluginUi] Isolated Plugin UI activation failure: ${pluginId}`);
      }
    }
  };
  const enqueueSync = (): Promise<void> => {
    const result = tail.then(synchronize, synchronize);
    tail = result.catch(() => undefined);
    return result;
  };
  const reportSyncFailure = () => {
    console.warn('[DeclarativePluginUi] Snapshot synchronization failed; waiting for the next update.');
  };
  const scheduleSync = () => {
    void enqueueSync().catch(reportSyncFailure);
  };

  // Subscribe first so a transient startup refresh failure cannot permanently
  // detach the gateway from later Plugin Management snapshots.
  const unsubscribe = service.subscribe(scheduleSync);
  try {
    await service.refreshInstalled();
  } catch {
    console.warn('[DeclarativePluginUi] Initial Plugin refresh failed; waiting for the next update.');
  }
  try {
    await enqueueSync();
  } catch {
    reportSyncFailure();
  }
  return async () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    await tail;
    const disposers = [...active.values()].map(({ dispose }) => dispose).reverse();
    active.clear();
    for (const dispose of disposers) await dispose();
  };
}

function desiredUiPlugins(
  plugins: readonly RuntimePluginSummary[],
  catalogRevision: string,
  service: PluginManagementRendererService,
): Map<string, Readonly<{ plugin: RendererPluginDefinition; signature: string }>> {
  const desired = new Map<string, Readonly<{ plugin: RendererPluginDefinition; signature: string }>>();
  for (const plugin of plugins) {
    if (plugin.extension?.trust !== 'trusted' || !plugin.extension.rendererUi) continue;
    try {
      const manifest = parseRuntimePluginUiManifest(plugin.extension.rendererUi);
      const contributions = manifest.contributions.map(assertHostAllowedContribution);
      const signature = JSON.stringify({
        description: plugin.description,
        icon: plugin.icon,
        installedAt: plugin.installedAt,
        catalogRevision,
        manifest,
        name: plugin.name,
        resources: plugin.resources,
      });
      desired.set(plugin.id, Object.freeze({
        plugin: declarativeRendererPlugin(plugin, manifest, contributions, catalogRevision, service),
        signature,
      }));
    } catch {
      console.warn(`[DeclarativePluginUi] Rejected Plugin UI manifest: ${plugin.id}`);
    }
  }
  return desired;
}

function declarativeRendererPlugin(
  plugin: RuntimePluginSummary,
  manifest: RuntimePluginUiManifest,
  contributions: readonly RuntimePluginUiContribution[],
  revision: string,
  service: PluginManagementRendererService,
): RendererPluginDefinition {
  const identity = rendererPluginIdentity(plugin.id);
  return defineRendererPlugin({
    id: `feature.third-party.${identity}`,
    activate({ ui }) {
      for (const contribution of contributions) {
        const entryId = `third-party.${identity}.${contribution.id}`;
        if (contribution.slot === 'renderer.chat.composer.status') {
          if (!contribution.tree) throw new Error('Chat Plugin UI requires a declarative tree.');
          ui.list(chatComposerStatusSlot, {
            id: entryId,
            order: contribution.order ?? 0,
            render: ({ threadId, translate }) => (
              <DeclarativePluginUiView
                contribution={contribution}
                manifest={manifest}
                pluginId={plugin.id}
                service={service}
                threadId={threadId}
                translate={translate}
              />
            ),
          });
          continue;
        }
        if (contribution.slot === 'renderer.capabilities.plugin.details') {
          if (!contribution.tree) throw new Error('Plugin details UI requires a declarative tree.');
          registerSettingsPage(ui, {
            entryId,
            location: 'capabilities',
            order: contribution.order ?? 0,
            pageHeading: 'view',
            sectionId: plugin.id,
            titleKey: 'feature.pluginManagement.title',
            render: ({ translate, ui: settingsUi }) => (
              <DeclarativePluginUiView
                contribution={contribution}
                manifest={manifest}
                pluginId={plugin.id}
                service={service}
                settingsUi={settingsUi}
                translate={translate}
              />
            ),
          });
          continue;
        }
        if (contribution.slot === 'renderer.settings.page.extensions') {
          if (!contribution.tree) throw new Error('Settings Plugin UI requires a declarative tree.');
          if (!contribution.target) throw new Error('Settings Plugin UI requires a host target.');
          registerSettingsPageExtension(ui, {
            entryId,
            id: `third-party.${identity}.${contribution.id}`,
            order: contribution.order ?? 0,
            targetSectionId: contribution.target,
            render: ({ translate, ui: settingsUi }) => (
              <DeclarativePluginUiView
                contribution={contribution}
                manifest={manifest}
                pluginId={plugin.id}
                service={service}
                settingsUi={settingsUi}
                translate={translate}
              />
            ),
          });
          continue;
        }
        const viewKey = rendererPluginViewKey(plugin.id, contribution.id);
        ui.list(shellSidebarPluginEntrySlot, {
          id: `${entryId}.navigation`,
          order: contribution.order ?? 0,
          render: ({ activeViewKey, onOpen, projectId, threadId }) => (
            <DeclarativePluginSidebarEntry
              active={activeViewKey === viewKey}
              contribution={contribution}
              plugin={plugin}
              projectId={projectId}
              service={service}
              threadId={threadId}
              onOpen={() => onOpen(viewKey)}
            />
          ),
        });
        ui.keyed(shellPluginPageSlot, {
          id: `${entryId}.page`,
          key: viewKey,
          priority: 0,
          render: ({ cwd, projectId, threadId }) => (
            <DeclarativePluginPage
              contribution={contribution}
              cwd={cwd}
              manifest={manifest}
              plugin={plugin}
              projectId={projectId}
              revision={revision}
              service={service}
              threadId={threadId}
            />
          ),
        });
      }
    },
  });
}

/** Plugin ids are path-safe, but Renderer identities intentionally use a narrower alphabet. */
export function rendererPluginIdentity(pluginId: string): string {
  return `p-${[...pluginId].map((character) => character.codePointAt(0)?.toString(16)).join('-')}`;
}

export function assertHostAllowedContribution(
  contribution: RuntimePluginUiContribution,
): RuntimePluginUiContribution {
  if (contribution.slot === 'renderer.capabilities.plugin.details') {
    if (!contribution.tree) throw new Error('Plugin details UI requires a declarative tree.');
    return contribution;
  }
  if (contribution.slot === 'renderer.settings.page.extensions') {
    if (!contribution.target || !SETTINGS_TARGET_ALLOWLIST.has(contribution.target)) {
      throw new Error(`Settings target is not host-allowlisted: ${String(contribution.target)}`);
    }
    return contribution;
  }
  if (contribution.slot === 'renderer.plugin.page') return contribution;
  if (!contribution.tree) throw new Error('Embedded Plugin UI requires a declarative tree.');
  visitNodes(contribution.tree, (node) => {
    if (!CHAT_NODE_ALLOWLIST.has(node.type)) {
      throw new Error(`Node ${node.type} is not allowed in the chat composer status Slot.`);
    }
  });
  return contribution;
}

function missingContributionContext(
  contribution: RuntimePluginUiContribution,
  projectId?: string,
  threadId?: string,
): 'project' | 'thread' | null {
  if (contribution.data?.scope === 'project' && !projectId) return 'project';
  if (contribution.data?.scope === 'thread' && !threadId) return 'thread';
  return null;
}

function DeclarativePluginSidebarEntry({
  active,
  contribution,
  plugin,
  projectId,
  service,
  threadId,
  onOpen,
}: Readonly<{
  active: boolean;
  contribution: RuntimePluginUiContribution;
  plugin: RuntimePluginSummary;
  projectId?: string;
  service: PluginManagementRendererService;
  threadId?: string;
  onOpen(): void;
}>) {
  const { t } = useI18n();
  const missingContext = missingContributionContext(contribution, projectId, threadId);
  const { data } = useDeclarativePluginUiData({ contribution, pluginId: plugin.id, projectId, service, threadId });
  const badge = missingContext
    ? t(missingContext === 'project' ? 'pluginUi.projectRequired' : 'pluginUi.threadRequired')
    : resolveRuntimePluginUiText(contribution.navigation?.badge, data);
  return (
    <button
      className={`desktop-agent-command${active ? ' is-active' : ''}`}
      onClick={onOpen}
      title={missingContext ? badge : undefined}
      type="button"
    >
      <PluginIcon
        className="declarative-plugin-navigation__icon"
        name={plugin.icon}
        pluginId={plugin.id}
        variant="menu"
      />
      <span className="desktop-agent-command__label">{contribution.navigation?.label}</span>
      {badge ? <span className="declarative-plugin-navigation__badge">{badge}</span> : null}
    </button>
  );
}

function DeclarativePluginPage({
  contribution,
  cwd,
  manifest,
  plugin,
  projectId,
  revision,
  service,
  threadId,
}: Readonly<{
  contribution: RuntimePluginUiContribution;
  cwd?: string;
  manifest: RuntimePluginUiManifest;
  plugin: RuntimePluginSummary;
  projectId?: string;
  revision: string;
  service: PluginManagementRendererService;
  threadId?: string;
}>) {
  const { t } = useI18n();
  const missingContext = missingContributionContext(contribution, projectId, threadId);
  return (
    <main className="declarative-plugin-page">
      <header className="declarative-plugin-page__header">
        <PluginIcon name={plugin.icon} pluginId={plugin.id} variant="list" />
        <div>
          <h1>{contribution.navigation?.label}</h1>
          {plugin.description ? <p>{plugin.description}</p> : null}
        </div>
      </header>
      <section className={`declarative-plugin-page__content${contribution.document ? ' is-sandboxed' : ''}`}>
        {missingContext ? (
          <div className="declarative-plugin-ui">
            <div className="declarative-plugin-ui__notice is-warning" role="status">
              <strong>
                {t(missingContext === 'project' ? 'pluginUi.projectRequired' : 'pluginUi.threadRequired')}
              </strong>
              <span>
                {t(missingContext === 'project'
                  ? 'pluginUi.projectRequiredDescription'
                  : 'pluginUi.threadRequiredDescription')}
              </span>
            </div>
          </div>
        ) : (
          contribution.document ? (
            <SandboxedPluginUiView
              contribution={contribution}
              cwd={cwd}
              manifest={manifest}
              pluginId={plugin.id}
              projectId={projectId}
              revision={revision}
              service={service}
              threadId={threadId}
            />
          ) : (
            <DeclarativePluginUiView
              contribution={contribution}
              cwd={cwd}
              manifest={manifest}
              pluginId={plugin.id}
              projectId={projectId}
              service={service}
              threadId={threadId}
            />
          )
        )}
      </section>
    </main>
  );
}

function visitNodes(node: RuntimePluginUiNode, visit: (node: RuntimePluginUiNode) => void): void {
  visit(node);
  if (node.type === 'stack') node.children.forEach((child) => visitNodes(child, visit));
}

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
import { registerSettingsPage } from '@setsuna-desktop/renderer-contracts/settings';
import type { RendererPluginRuntime } from '../renderer-plugins/runtime.js';
import { DeclarativePluginUiView } from './DeclarativePluginUiView.js';

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
    const desired = desiredUiPlugins(service.getSnapshot().plugins, service);
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
  service: PluginManagementRendererService,
): Map<string, Readonly<{ plugin: RendererPluginDefinition; signature: string }>> {
  const desired = new Map<string, Readonly<{ plugin: RendererPluginDefinition; signature: string }>>();
  for (const plugin of plugins) {
    if (plugin.extension?.trust !== 'trusted' || !plugin.extension.rendererUi) continue;
    try {
      const manifest = parseRuntimePluginUiManifest(plugin.extension.rendererUi);
      const contributions = manifest.contributions.map(assertHostAllowedContribution);
      const signature = JSON.stringify(manifest);
      desired.set(plugin.id, Object.freeze({
        plugin: declarativeRendererPlugin(plugin.id, manifest, contributions, service),
        signature,
      }));
    } catch {
      console.warn(`[DeclarativePluginUi] Rejected Plugin UI manifest: ${plugin.id}`);
    }
  }
  return desired;
}

function declarativeRendererPlugin(
  pluginId: string,
  manifest: RuntimePluginUiManifest,
  contributions: readonly RuntimePluginUiContribution[],
  service: PluginManagementRendererService,
): RendererPluginDefinition {
  const identity = rendererPluginIdentity(pluginId);
  return defineRendererPlugin({
    id: `feature.third-party.${identity}`,
    activate({ ui }) {
      for (const contribution of contributions) {
        const entryId = `third-party.${identity}.${contribution.id}`;
        if (contribution.slot === 'renderer.chat.composer.status') {
          ui.list(chatComposerStatusSlot, {
            id: entryId,
            order: contribution.order ?? 0,
            render: ({ threadId, translate }) => (
              <DeclarativePluginUiView
                contribution={contribution}
                manifest={manifest}
                pluginId={pluginId}
                service={service}
                threadId={threadId}
                translate={translate}
              />
            ),
          });
          continue;
        }
        registerSettingsPage(ui, {
          entryId,
          location: 'capabilities',
          order: contribution.order ?? 0,
          pageHeading: 'view',
          sectionId: pluginId,
          titleKey: 'feature.pluginManagement.title',
          render: ({ translate, ui: settingsUi }) => (
            <DeclarativePluginUiView
              contribution={contribution}
              manifest={manifest}
              pluginId={pluginId}
              service={service}
              settingsUi={settingsUi}
              translate={translate}
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
  if (contribution.slot === 'renderer.capabilities.plugin.details') return contribution;
  visitNodes(contribution.tree, (node) => {
    if (!CHAT_NODE_ALLOWLIST.has(node.type)) {
      throw new Error(`Node ${node.type} is not allowed in the chat composer status Slot.`);
    }
  });
  return contribution;
}

function visitNodes(node: RuntimePluginUiNode, visit: (node: RuntimePluginUiNode) => void): void {
  visit(node);
  if (node.type === 'stack') node.children.forEach((child) => visitNodes(child, visit));
}

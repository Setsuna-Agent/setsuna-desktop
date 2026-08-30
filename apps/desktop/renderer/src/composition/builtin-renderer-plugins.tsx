import {
  declareRendererChildSlot,
  defineRendererPlugin,
  type RendererPluginDefinition,
  type RendererSingleSlot,
  type RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type { Disposer } from '@setsuna-desktop/feature-core/scope';
import {
  chatComposerSlot,
  chatComposerStatusSlot,
  chatConversationSlot,
  chatDetailsSlot,
} from '@setsuna-desktop/renderer-contracts/chat';
import {
  registerSettingsPage,
  registerSettingsPageExtension,
  settingsPageKey,
  settingsPageExtensionSlot,
  settingsPageSlot,
  type SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import {
  Archive,
  Bot,
  Info,
  Keyboard,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  appReadySlot,
  shellOverlaySlot,
  shellRouteSlot,
  shellSidebarSlot,
  shellTopbarActionsSlot,
  shellTopbarActionSlot,
  shellTopbarTitleSlot,
  shellWorkspaceToolbarSlot,
  type RendererAppRouteId,
} from '@setsuna-desktop/renderer-contracts/shell';
import {
  workspacePanelSlot,
  type RendererWorkspacePanelType,
} from '@setsuna-desktop/renderer-contracts/workspace';
import { RendererOwnedSlotsProvider } from '../kernel/renderer-plugins/RendererKernelProvider.js';
import type { RendererPluginRuntime } from '../kernel/renderer-plugins/runtime.js';
import type { RendererLayoutPreferenceController } from '../kernel/renderer-plugins/layout-preference-controller.js';
import { useState, type ReactNode } from 'react';
import { RendererPluginInspectorSettings } from './renderer-plugins/RendererPluginInspectorSettings.js';
import { FeatureRecoveryShell } from './FeatureRecoveryShell.js';

const REQUIRED_APP_ROUTE_IDS: readonly RendererAppRouteId[] = Object.freeze([
  'chat',
  'settings',
  'capabilities',
]);

const WORKSPACE_PANEL_TYPES: readonly RendererWorkspacePanelType[] = Object.freeze([
  'overview',
  'browser',
  'chat',
  'subagent',
  'conversation-debug',
  'files',
  'file',
  'review',
  'terminal',
]);

const CORE_SETTINGS_PAGES = Object.freeze([
  ['general', 'preferences', 100, 'settings.section.general', SlidersHorizontal],
  ['shortcuts', 'preferences', 200, 'settings.section.shortcuts', Keyboard, 'settings.section.shortcutsDescription'],
  ['personalization', 'preferences', 300, 'settings.section.personalization', Sparkles],
  ['taskModels', 'models-and-services', 300, 'settings.section.taskModels', Bot, 'settings.section.taskModelsDescription'],
  ['archives', 'data-and-system', 100, 'settings.section.archives', Archive],
  ['runtime', 'data-and-system', 200, 'settings.section.runtime', Wrench],
  ['about', 'data-and-system', 300, 'settings.section.about', Info],
] as const);

const REQUIRED_SETTINGS_PAGE_KEYS = Object.freeze(
  CORE_SETTINGS_PAGES.map(([sectionId]) => settingsPageKey('settings', sectionId)),
);

const REQUIRED_CAPABILITIES_PAGE_KEYS = Object.freeze([
  settingsPageKey('capabilities', 'plugins'),
  settingsPageKey('capabilities', 'skills'),
  settingsPageKey('capabilities', 'mcp'),
]);

const CAPABILITIES_FEATURE_ID_BY_SECTION: Readonly<Record<string, string>> = Object.freeze({
  mcp: 'mcp',
  plugins: 'plugin-management',
  skills: 'skills',
});

const HOST_WORKSPACE_PANEL_TYPES = WORKSPACE_PANEL_TYPES.filter((panelType) => (
  panelType !== 'browser' && panelType !== 'terminal'
));

const appShellPlugin = defineRendererPlugin({
  id: 'core.app-shell',
  activate({ ui }) {
    ui.single(appReadySlot, {
      id: 'app-shell.default',
      priority: 0,
      children: [
        declareRendererChildSlot(shellSidebarSlot, { required: true }),
        declareRendererChildSlot(shellTopbarTitleSlot, { required: true }),
        declareRendererChildSlot(shellTopbarActionsSlot, { required: true }),
        declareRendererChildSlot(shellWorkspaceToolbarSlot, { required: true }),
        declareRendererChildSlot(shellRouteSlot, { requiredKeys: REQUIRED_APP_ROUTE_IDS }),
        declareRendererChildSlot(shellOverlaySlot, { required: true }),
      ],
      render: ({ renderDefault }, slots) => (
        <RendererOwnedSlotsProvider slots={slots}>
          {renderDefault()}
        </RendererOwnedSlotsProvider>
      ),
    });
  },
});

const routePlugin = defineRendererPlugin({
  id: 'core.routes',
  activate({ ui }) {
    registerRoute(ui, 'chat', [
      declareRendererChildSlot(chatConversationSlot, { required: true }),
      declareRendererChildSlot(chatComposerSlot, { required: true }),
      declareRendererChildSlot(chatDetailsSlot, { required: true }),
      declareRendererChildSlot(workspacePanelSlot, { requiredKeys: WORKSPACE_PANEL_TYPES }),
    ]);
    registerRoute(ui, 'settings', [
      declareRendererChildSlot(settingsPageSlot, { requiredKeys: REQUIRED_SETTINGS_PAGE_KEYS }),
      declareRendererChildSlot(settingsPageExtensionSlot),
    ]);
    registerRoute(ui, 'capabilities', [
      declareRendererChildSlot(settingsPageSlot, {
        fallback: {
          render: ({ sectionId }) => (
            <FeatureRecoveryShell
              candidateFeatureIds={[CAPABILITIES_FEATURE_ID_BY_SECTION[sectionId] ?? sectionId]}
              reason="view-missing"
            />
          ),
        },
        requiredKeys: REQUIRED_CAPABILITIES_PAGE_KEYS,
      }),
    ]);
  },
});

const shellRegionsPlugin = defineRendererPlugin({
  id: 'core.shell-regions',
  activate({ ui }) {
    registerDefaultSingle(ui, shellSidebarSlot, 'shell.sidebar.default');
    registerDefaultSingle(ui, shellTopbarTitleSlot, 'shell.topbar-title.default');
    ui.single(shellTopbarActionsSlot, {
      id: 'shell.topbar-actions.default',
      priority: 0,
      children: [declareRendererChildSlot(shellTopbarActionSlot)],
      render: ({ renderDefault }, slots) => (
        <RendererOwnedSlotsProvider slots={slots}>
          {renderDefault()}
        </RendererOwnedSlotsProvider>
      ),
    });
    registerDefaultSingle(ui, shellWorkspaceToolbarSlot, 'shell.workspace-toolbar.default');
    registerDefaultSingle(ui, shellOverlaySlot, 'shell.overlay.default');
  },
});

const chatHostPlugin = defineRendererPlugin({
  id: 'core.chat-host',
  activate({ ui }) {
    registerDefaultSingle(ui, chatConversationSlot, 'chat.conversation.default');
    ui.single(chatComposerSlot, {
      id: 'chat.composer.default',
      priority: 0,
      children: [declareRendererChildSlot(chatComposerStatusSlot)],
      render: ({ renderDefault }, slots) => (
        <RendererOwnedSlotsProvider slots={slots}>
          {renderDefault()}
        </RendererOwnedSlotsProvider>
      ),
    });
    registerDefaultSingle(ui, chatDetailsSlot, 'chat.details.default');
  },
});

const workspaceHostPlugin = defineRendererPlugin({
  id: 'core.workspace-host',
  activate({ ui }) {
    for (const panelType of HOST_WORKSPACE_PANEL_TYPES) {
      ui.keyed(workspacePanelSlot, {
        id: `workspace.${panelType}.default`,
        key: panelType,
        priority: 0,
        render: ({ renderDefault }) => renderDefault(),
      });
    }
  },
});

const coreSettingsPlugin = defineRendererPlugin({
  id: 'core.settings',
  activate({ ui }) {
    for (const [sectionId, navigationGroupId, order, titleKey, icon, descriptionKey] of CORE_SETTINGS_PAGES) {
      registerSettingsPage(ui, {
        entryId: `settings.${sectionId.toLowerCase()}`,
        descriptionKey,
        icon,
        location: 'settings',
        navigationGroupId,
        order,
        sectionId,
        titleKey,
        render: ({ renderDefault }) => renderDefault?.() ?? null,
      });
    }
  },
});

const builtinRendererPlugins: readonly RendererPluginDefinition[] = Object.freeze([
  appShellPlugin,
  routePlugin,
  shellRegionsPlugin,
  chatHostPlugin,
  workspaceHostPlugin,
  coreSettingsPlugin,
]);

export async function activateBuiltinRendererPlugins(
  runtime: RendererPluginRuntime,
  options: Readonly<{
    layoutPreferences: RendererLayoutPreferenceController;
  }>,
): Promise<Disposer> {
  const activated: Array<readonly Disposer[]> = [];
  try {
    const plugins = [
      ...builtinRendererPlugins,
      createLayoutPreferencesSettingsPlugin(options.layoutPreferences),
    ];
    for (const plugin of plugins) {
      const disposers: Disposer[] = [];
      const ui = runtime.createRegistrar(
        Object.freeze({ pluginId: plugin.id, scopeId: `host:${plugin.id}` }),
        (disposer) => disposers.push(disposer),
      );
      await plugin.activate(Object.freeze({ ui }));
      activated.push(Object.freeze(disposers));
    }
  } catch (error) {
    await disposePluginRegistrations(activated);
    throw error;
  }
  let disposed = false;
  return async () => {
    if (disposed) return;
    disposed = true;
    await disposePluginRegistrations(activated);
  };
}

function createLayoutPreferencesSettingsPlugin(
  controller: RendererLayoutPreferenceController,
): RendererPluginDefinition {
  return defineRendererPlugin({
    id: 'core.layout-preferences',
    activate({ ui }) {
      registerSettingsPageExtension(ui, {
        entryId: 'settings.layout-preferences',
        id: 'layout-preferences',
        order: 900,
        targetSectionId: 'runtime',
        render: (props) => <LayoutPreferencesSettings controller={controller} {...props} />,
      });
      registerSettingsPageExtension(ui, {
        entryId: 'settings.renderer-inspector',
        id: 'renderer-inspector',
        order: 950,
        targetSectionId: 'runtime',
        render: (props) => <RendererPluginInspectorSettings {...props} />,
      });
    },
  });
}

function LayoutPreferencesSettings({
  controller,
  translate,
  ui,
}: Readonly<{
  controller: RendererLayoutPreferenceController;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const [status, setStatus] = useState<'idle' | 'resetting' | 'done' | 'error'>('idle');
  const reset = async () => {
    setStatus('resetting');
    try {
      await controller.reset();
      setStatus('done');
    } catch {
      setStatus('error');
    }
  };
  return (
    <ui.Section featureId="core.layout-preferences">
      <ui.Group>
        <ui.Row
          description={translate('feature.rendererLayout.description')}
          label={translate('feature.rendererLayout.preferences')}
        >
          <div className="renderer-layout-preferences__actions">
            <ui.Button
              disabled={status === 'resetting'}
              icon={<RotateCcw size={13} />}
              onClick={() => void reset()}
            >
              {translate(status === 'resetting' ? 'feature.rendererLayout.resetting' : 'feature.rendererLayout.reset')}
            </ui.Button>
          </div>
        </ui.Row>
      </ui.Group>
      {status === 'done' ? <ui.Toast message={translate('feature.rendererLayout.resetDone')} tone="success" /> : null}
      {status === 'error' ? <ui.Toast message={translate('feature.rendererLayout.resetError')} tone="error" /> : null}
    </ui.Section>
  );
}

function registerRoute(
  ui: Parameters<RendererPluginDefinition['activate']>[0]['ui'],
  routeId: RendererAppRouteId,
  children: Parameters<typeof ui.keyed>[1]['children'],
): void {
  ui.keyed(shellRouteSlot, {
    id: `routes.${routeId}`,
    key: routeId,
    priority: 0,
    children,
    render: ({ renderDefault }, slots) => (
      <RendererOwnedSlotsProvider slots={slots}>
        {renderDefault()}
      </RendererOwnedSlotsProvider>
    ),
  });
}

function registerDefaultSingle<TProps extends Readonly<{ renderDefault(): ReactNode }>>(
  ui: Parameters<RendererPluginDefinition['activate']>[0]['ui'],
  slot: RendererSingleSlot<TProps>,
  id: string,
): void {
  ui.single(slot, {
    id,
    priority: 0,
    render: ({ renderDefault }) => renderDefault(),
  });
}

async function disposePluginRegistrations(groups: readonly (readonly Disposer[])[]): Promise<void> {
  const errors: unknown[] = [];
  for (const group of [...groups].reverse()) {
    for (const dispose of [...group].reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Failed to dispose Renderer Plugin registrations.');
}

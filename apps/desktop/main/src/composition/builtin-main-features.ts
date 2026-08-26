import type {
  RuntimeInterfaceLanguage,
  RuntimeRequestInput,
} from '@setsuna-desktop/contracts';
import {
  provideHostCapability,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  completeFeatureHostActivation,
  defineMainFeatureHost,
  type MainFeatureComposition,
} from '@setsuna-desktop/feature-core/main';
import type { BrowserControlConnection } from '@setsuna-desktop/feature-browser/contracts';
import {
  browserControlConnectionCapability,
  browserMainFeature,
  browserMainHostCapability,
} from '@setsuna-desktop/feature-browser/main';
import {
  networkProxyMainFeature,
  networkProxyMainHostCapability,
  networkProxyMainServiceCapability,
  type NetworkProxyMainHost,
  type NetworkProxyMainService,
} from '@setsuna-desktop/feature-network-proxy/main';
import {
  pluginManagementMainFeature,
  pluginManagementMainHostCapability,
  type PluginManagementMainHost,
} from '@setsuna-desktop/feature-plugin-management/main';
import {
  generateReviewCommitMessage,
  reviewCommitMessageCapability,
  reviewFilePreviewCapability,
  reviewRendererSenderCapability,
  type DesktopCommitMessageGenerationSource,
} from '@setsuna-desktop/feature-review/contracts';
import { reviewMainFeature } from '@setsuna-desktop/feature-review/main';
import {
  TERMINAL_IPC_CHANNELS,
  type DesktopTerminalEventPayload,
  terminalEnvironmentCapability,
  terminalEventPublisherCapability,
} from '@setsuna-desktop/feature-terminal/contracts';
import { terminalMainFeature } from '@setsuna-desktop/feature-terminal/main';
import {
  updaterLifecycleCapability,
  updaterMainFeature,
  updaterMainHostCapability,
  type UpdaterLifecycle,
  type UpdaterMainHost,
} from '@setsuna-desktop/feature-updater/main';
import {
  webDavSyncLifecycleCapability,
  webDavSyncMainFeature,
  webDavSyncMainHostCapability,
  type WebDavSyncLifecycle,
  type WebDavSyncMainHost,
} from '@setsuna-desktop/feature-webdav-sync/main';
import { workspaceAppsMainFeature } from '@setsuna-desktop/feature-workspace-apps/main';
import {
  windowsSandboxMainFeature,
  windowsSandboxMainHostCapability,
  windowsSandboxMainServiceCapability,
  type WindowsSandboxMainHost,
  type WindowsSandboxMainService,
} from '@setsuna-desktop/feature-windows-sandbox/main';
import type { BrowserWindow } from 'electron';
import type { DesktopNativeBridgeServer } from '../runtime/native-bridge-server.js';
import { desktopShellPath } from '../runtime/desktop-environment.js';
import { resolveWorkspaceFilePreview } from '../workspace/file-opening.js';

const mainFeatures = defineMainFeatureHost({
  required: [
    browserMainFeature,
    networkProxyMainFeature,
    pluginManagementMainFeature,
    reviewMainFeature,
    terminalMainFeature,
    updaterMainFeature,
    webDavSyncMainFeature,
    windowsSandboxMainFeature,
    workspaceAppsMainFeature,
  ],
  optional: [],
});

export type ActivatedBuiltinMainFeatures = Readonly<{
  browserControl: BrowserControlConnection;
  composition: MainFeatureComposition;
  networkProxy: NetworkProxyMainService;
  updater: UpdaterLifecycle;
  webDavSync: WebDavSyncLifecycle;
  windowsSandbox: WindowsSandboxMainService;
}>;

export async function activateBuiltinMainFeatures(input: Readonly<{
  activeKeyboardShortcutBindings(): ReadonlySet<string>;
  interfaceLanguage(): RuntimeInterfaceLanguage;
  mainWindow: BrowserWindow;
  nativeBridge: DesktopNativeBridgeServer;
  networkProxy(): NetworkProxyMainService;
  networkProxyHost: NetworkProxyMainHost;
  pluginManagementHost: PluginManagementMainHost;
  requestRuntime(input: RuntimeRequestInput): Promise<unknown>;
  updaterHost: UpdaterMainHost;
  webDavSyncHost: WebDavSyncMainHost;
  windowsSandboxHost: WindowsSandboxMainHost;
}>): Promise<ActivatedBuiltinMainFeatures> {
  const composition = await mainFeatures.activate({
    hostCapabilities: [
      provideHostCapability(
        browserMainHostCapability,
        Object.freeze({
          activeKeyboardShortcutBindings: input.activeKeyboardShortcutBindings,
          interfaceLanguage: input.interfaceLanguage,
          mainWindow: input.mainWindow,
        }),
      ),
      provideHostCapability(
        networkProxyMainHostCapability,
        input.networkProxyHost,
      ),
      provideHostCapability(
        pluginManagementMainHostCapability,
        input.pluginManagementHost,
      ),
      provideHostCapability(
        reviewCommitMessageCapability,
        Object.freeze({
          generate: async (source: DesktopCommitMessageGenerationSource) => {
            const result = await input.requestRuntime({
              path: generateReviewCommitMessage.path,
              method: generateReviewCommitMessage.method,
              body: source,
            });
            return generateReviewCommitMessage.output.parse(result).message;
          },
        }),
      ),
      provideHostCapability(
        reviewFilePreviewCapability,
        Object.freeze({
          createWorkspacePreview: async (workspaceRoot: string, filePath: string) => {
            const resolved = await resolveWorkspaceFilePreview(workspaceRoot, filePath);
            if (!resolved.ok) return resolved;
            return {
              ok: true as const,
              ...input.nativeBridge.registerManagedFilePreview(resolved.preview),
            };
          },
          registerContentPreview: (preview: Readonly<{
            content: Uint8Array;
            mimeType: string;
            name: string;
          }>) => input.nativeBridge.registerContentPreview({
            ...preview,
            content: Buffer.from(
              preview.content.buffer,
              preview.content.byteOffset,
              preview.content.byteLength,
            ),
          }),
          release: (previewId: string) => input.nativeBridge.releaseFilePreview(previewId),
        }),
      ),
      provideHostCapability(
        reviewRendererSenderCapability,
        Object.freeze({
          isAllowed: (senderId: number) => (
            !input.mainWindow.isDestroyed()
            && !input.mainWindow.webContents.isDestroyed()
            && input.mainWindow.webContents.id === senderId
          ),
        }),
      ),
      provideHostCapability(
        terminalEnvironmentCapability,
        Object.freeze({
          resolve: async () => Object.freeze({
            PATH: desktopShellPath(process.env.PATH),
            ...await input.networkProxy().environmentFor('terminal'),
          }),
        }),
      ),
      provideHostCapability(
        terminalEventPublisherCapability,
        Object.freeze({
          publish: (event: DesktopTerminalEventPayload) => {
            if (!input.mainWindow.isDestroyed() && !input.mainWindow.webContents.isDestroyed()) {
              input.mainWindow.webContents.send(TERMINAL_IPC_CHANNELS.event, event);
            }
          },
        }),
      ),
      provideHostCapability(
        updaterMainHostCapability,
        input.updaterHost,
      ),
      provideHostCapability(
        webDavSyncMainHostCapability,
        input.webDavSyncHost,
      ),
      provideHostCapability(
        windowsSandboxMainHostCapability,
        input.windowsSandboxHost,
      ),
    ],
  });
  return completeFeatureHostActivation(composition, (host) => {
    const dependencies = host.composition.resolveHostDependencies({
      browserControl: requiredCapability(browserControlConnectionCapability),
      networkProxy: requiredCapability(networkProxyMainServiceCapability),
      updater: requiredCapability(updaterLifecycleCapability),
      webDavSync: requiredCapability(webDavSyncLifecycleCapability),
      windowsSandbox: requiredCapability(windowsSandboxMainServiceCapability),
    });
    return Object.freeze({
      browserControl: dependencies.browserControl,
      composition: host.composition,
      networkProxy: dependencies.networkProxy,
      updater: dependencies.updater,
      webDavSync: dependencies.webDavSync,
      windowsSandbox: dependencies.windowsSandbox,
    });
  });
}

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
  webDavSyncLifecycleCapability,
  webDavSyncMainFeature,
  webDavSyncMainHostCapability,
  type WebDavSyncLifecycle,
  type WebDavSyncMainHost,
} from '@setsuna-desktop/feature-webdav-sync/main';
import type { BrowserWindow } from 'electron';
import type { DesktopNetworkProxyService } from '../network-proxy/service.js';
import type { DesktopNativeBridgeServer } from '../runtime/native-bridge-server.js';
import { desktopShellPath } from '../runtime/desktop-environment.js';
import { resolveWorkspaceFilePreview } from '../workspace/file-opening.js';

const mainFeatures = defineMainFeatureHost({
  required: [browserMainFeature, reviewMainFeature, terminalMainFeature, webDavSyncMainFeature],
  optional: [],
});

export type ActivatedBuiltinMainFeatures = Readonly<{
  browserControl: BrowserControlConnection;
  composition: MainFeatureComposition;
  webDavSync: WebDavSyncLifecycle;
}>;

export async function activateBuiltinMainFeatures(input: Readonly<{
  activeKeyboardShortcutBindings(): ReadonlySet<string>;
  interfaceLanguage(): RuntimeInterfaceLanguage;
  mainWindow: BrowserWindow;
  nativeBridge: DesktopNativeBridgeServer;
  networkProxyService: DesktopNetworkProxyService;
  requestRuntime(input: RuntimeRequestInput): Promise<unknown>;
  webDavSyncHost: WebDavSyncMainHost;
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
        reviewCommitMessageCapability,
        Object.freeze({
          generate: async (source: DesktopCommitMessageGenerationSource) => {
            const result = await input.requestRuntime({
              path: '/v1/git/commit-message/generate',
              method: 'POST',
              body: source,
            });
            const message = result && typeof result === 'object'
              ? (result as { message?: unknown }).message
              : undefined;
            return String(message ?? '').trim();
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
            ...await input.networkProxyService.environmentFor('terminal'),
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
        webDavSyncMainHostCapability,
        input.webDavSyncHost,
      ),
    ],
  });
  return completeFeatureHostActivation(composition, (host) => {
    const dependencies = host.composition.resolveHostDependencies({
      browserControl: requiredCapability(browserControlConnectionCapability),
      webDavSync: requiredCapability(webDavSyncLifecycleCapability),
    });
    return Object.freeze({
      browserControl: dependencies.browserControl,
      composition: host.composition,
      webDavSync: dependencies.webDavSync,
    });
  });
}

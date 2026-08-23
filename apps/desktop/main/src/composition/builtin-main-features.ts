import { declareCapabilityProvider, provideHostCapability } from '@setsuna-desktop/feature-core/capability';
import {
  composeMainFeatures,
  mountMainFeature,
  type MainFeatureComposition,
  type MainFeatureMount,
} from '@setsuna-desktop/feature-core/main';
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
import type { BrowserWindow } from 'electron';
import type { DesktopNetworkProxyService } from '../network-proxy/service.js';
import type { RuntimeHost } from '../runtime/host.js';
import type { DesktopNativeBridgeServer } from '../runtime/native-bridge-server.js';
import { desktopShellPath } from '../runtime/desktop-environment.js';
import { resolveWorkspaceFilePreview } from '../workspace/file-opening.js';

/** Main-process Features are explicit so native ownership and startup policy stay reviewable. */
export const builtinMainFeatures = [
  mountMainFeature(reviewMainFeature, { criticality: 'required' }),
  mountMainFeature(terminalMainFeature, { criticality: 'required' }),
] as const satisfies readonly MainFeatureMount[];

export function activateBuiltinMainFeatures(input: Readonly<{
  mainWindow: BrowserWindow;
  nativeBridge: DesktopNativeBridgeServer;
  networkProxyService: DesktopNetworkProxyService;
  runtimeHost: RuntimeHost;
}>): Promise<MainFeatureComposition> {
  return composeMainFeatures({
    mounts: builtinMainFeatures,
    hostCapabilities: [
      provideHostCapability(
        declareCapabilityProvider(reviewCommitMessageCapability),
        Object.freeze({
          generate: async (source: DesktopCommitMessageGenerationSource) => {
            const result = await input.runtimeHost.request<{ message?: unknown }>({
              path: '/v1/git/commit-message/generate',
              method: 'POST',
              body: source,
            });
            return String(result.message ?? '').trim();
          },
        }),
      ),
      provideHostCapability(
        declareCapabilityProvider(reviewFilePreviewCapability),
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
        declareCapabilityProvider(reviewRendererSenderCapability),
        Object.freeze({
          isAllowed: (senderId: number) => (
            !input.mainWindow.isDestroyed()
            && !input.mainWindow.webContents.isDestroyed()
            && input.mainWindow.webContents.id === senderId
          ),
        }),
      ),
      provideHostCapability(
        declareCapabilityProvider(terminalEnvironmentCapability),
        Object.freeze({
          resolve: async () => Object.freeze({
            PATH: desktopShellPath(process.env.PATH),
            ...await input.networkProxyService.environmentFor('terminal'),
          }),
        }),
      ),
      provideHostCapability(
        declareCapabilityProvider(terminalEventPublisherCapability),
        Object.freeze({
          publish: (event: DesktopTerminalEventPayload) => {
            if (!input.mainWindow.isDestroyed() && !input.mainWindow.webContents.isDestroyed()) {
              input.mainWindow.webContents.send(TERMINAL_IPC_CHANNELS.event, event);
            }
          },
        }),
      ),
    ],
  });
}

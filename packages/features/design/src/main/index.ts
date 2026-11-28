import { homedir } from 'node:os';
import { declareCapabilityProvider, defineCapability, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { designFeature } from '../contracts/index.js';
import { designMcpClientFiles } from './mcp/client-config.js';
import { DesignMcpIntegration } from './mcp/integration.js';
import { registerDesignMcpCanvas, registerDesignMcpSettings, type DesignMcpWindows } from './mcp/ipc.js';
import { registerDesignPublication } from './publication/ipc.js';
import type { DesignPackageMainHost } from './publication/design-export-files.js';
import type { DesignPackageImportHost } from './publication/design-import-file.js';

export const designMcpMainHostCapability = defineCapability<DesignMcpWindows & Readonly<{
  directory: string;
  appRoot: string;
  executable(): string;
  writeJsonAtomically(file: string, value: unknown): Promise<void>;
  copyText(value: string): void;
}>>({ id: 'design.mcp-main-host', description: 'Design MCP desktop lifecycle and app paths' });

export const designMcpLifecycleCapability = defineCapability<Readonly<{ restore(): void }>>({
  id: 'design.mcp-lifecycle', description: 'Restore opted-in Design MCP clients after the desktop is visible',
});
export type DesignPackageHost = DesignPackageMainHost & DesignPackageImportHost;
export const designPackageMainHostCapability = defineCapability<DesignPackageHost>({
  id: 'design.package-main-host', description: 'Main-only access to the runtime design package staging directory',
});
const lifecycle = declareCapabilityProvider(designMcpLifecycleCapability);

export const designMainFeature = defineMainFeature({
  definition: designFeature,
  dependencies: defineMainDependencies({
    host: requiredCapability(designMcpMainHostCapability),
    packages: requiredCapability(designPackageMainHostCapability),
  }),
  provides: [lifecycle],
  setup({ dependencies: { host, packages }, scope, provide }) {
    const canvas = registerDesignMcpCanvas(host, scope);
    const integration = new DesignMcpIntegration({ ...host, clientFiles: designMcpClientFiles(homedir(), process.env) }, canvas);
    scope.add(() => integration.dispose());
    registerDesignMcpSettings(host, scope, integration);
    registerDesignPublication({ ...host, ...packages }, scope);
    provide(lifecycle, {
      restore: () => {
        void integration.restore(scope.signal).catch((error: unknown) => {
          if (!scope.signal.aborted) console.warn('[design-mcp] Could not restore external clients:', error);
        });
      },
    });
  },
});

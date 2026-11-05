import { defineCapability, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { diagnosticsFeature } from '../contracts/index.js';
import { registerDiagnosticLogIpc } from './log-directory-ipc.js';

export const diagnosticsMainHostCapability = defineCapability<Readonly<{
  directory: string;
  isAllowedSender(id: number): boolean;
}>>({ id: 'diagnostics.main-host', description: 'Process-owned log location and trusted desktop identities' });

export const diagnosticsMainFeature = defineMainFeature({
  definition: diagnosticsFeature,
  dependencies: defineMainDependencies({ host: requiredCapability(diagnosticsMainHostCapability) }),
  setup({ dependencies: { host }, scope }) {
    scope.add(registerDiagnosticLogIpc(host.directory, host.isAllowedSender, scope));
  },
});

import { defineCapability, optionalCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRendererDependencies, defineRendererFeature } from '@setsuna-desktop/feature-core/renderer';
import { registerSettingsPage } from '@setsuna-desktop/renderer-contracts/settings';
import { FileText } from 'lucide-react';
import { diagnosticsFeature, type DiagnosticLogsBridge } from '../contracts/index.js';
import { diagnosticsMessages } from './messages.js';
import { DiagnosticLogsSettings } from './DiagnosticLogsSettings.js';

export const diagnosticsRendererHostCapability = defineCapability<DiagnosticLogsBridge | null>({
  id: 'diagnostics.renderer-host', description: 'Trusted access to the local diagnostic log directory',
});

export const diagnosticsRendererFeature = defineRendererFeature({
  definition: diagnosticsFeature,
  dependencies: defineRendererDependencies({ bridge: optionalCapability(diagnosticsRendererHostCapability, () => null) }),
  messages: [diagnosticsMessages],
  setup(context) {
    const bridge = context.dependencies.bridge;
    if (!bridge) return;
    registerSettingsPage(context.ui, {
      entryId: 'diagnostics.settings-page',
      sectionId: 'logs',
      location: 'settings',
      navigationGroupId: 'system',
      order: 175,
      titleKey: 'feature.diagnostics.title',
      icon: FileText,
      render: ({ translate, ui }) => <DiagnosticLogsSettings bridge={bridge} translate={translate} ui={ui} />,
    });
  },
});

import type { RuntimePluginSummary } from '@setsuna-desktop/contracts';

export function installedAppBuilder(): RuntimePluginSummary {
  return {
    id: 'app-builder', name: '应用构建器', icon: 'app-builder', installationSource: 'marketplace', installedAt: '',
    tools: ['read_runtime_api', 'configure_plugin', 'verify_plugin'].map((name) => ({ name })),
    skills: [], mcpServers: [], hooks: [], hookCount: 0, resources: [],
  };
}

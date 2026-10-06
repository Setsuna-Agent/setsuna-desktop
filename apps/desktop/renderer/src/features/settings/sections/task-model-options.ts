import type {
  RuntimeConfigState,
} from '@setsuna-desktop/contracts';
import type { SettingsModelOption } from '@setsuna-desktop/renderer-contracts/settings';

export function configuredTaskModelOptions(
  config: RuntimeConfigState,
): SettingsModelOption[] {
  const seen = new Set<string>();
  const options: SettingsModelOption[] = [];
  for (const provider of config.providers) {
    if (!provider.enabled) continue;
    for (const model of provider.models) {
      const code = model.code.trim();
      const modelId = model.id.trim();
      const key = `${provider.id}\0${modelId}`;
      if (!code || !modelId || seen.has(key)) continue;
      seen.add(key);
      options.push({
        providerId: provider.id,
        providerName: provider.name,
        modelId,
        modelName: model.name,
        modelCode: code,
      });
    }
  }
  return options;
}

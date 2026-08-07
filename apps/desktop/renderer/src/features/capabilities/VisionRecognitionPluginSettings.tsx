import type {
  RuntimeConfigState,
  RuntimeConfiguredModelReference,
  RuntimeVisionRecognitionConfigInput,
  RuntimeVisionRecognitionTestInput,
  RuntimeVisionRecognitionTestResult,
} from '@setsuna-desktop/contracts';
import { Eye, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SelectField } from '../../shared/ui/primitives.js';
import { VisionRecognitionPluginTest } from './VisionRecognitionPluginTest.js';

type VisionModelOption = {
  label: string;
  reference: RuntimeConfiguredModelReference;
  value: string;
};

/** 视觉插件只保存模型引用，供应商地址、凭据与代理全部复用“模型服务”配置。 */
export function VisionRecognitionPluginSettings({
  config,
  onSave,
  onTest,
}: {
  config?: RuntimeConfigState;
  onSave: (input: RuntimeVisionRecognitionConfigInput) => Promise<void>;
  onTest: (input: RuntimeVisionRecognitionTestInput) => Promise<RuntimeVisionRecognitionTestResult>;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const options = visionModelOptions(config);
  const selectedValue = configuredModelReferenceValue(config?.visionRecognition);
  const selectionAvailable = Boolean(selectedValue && options.some((option) => option.value === selectedValue));

  async function selectModel(value: string) {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const reference = options.find((option) => option.value === value)?.reference ?? null;
      await onSave(reference);
      setSaved(true);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSaving(false);
    }
  }

  async function runTest(input: RuntimeVisionRecognitionTestInput): Promise<RuntimeVisionRecognitionTestResult> {
    setTesting(true);
    setError(null);
    try {
      return await onTest(input);
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="desktop-image-generation-settings desktop-vision-recognition-settings" aria-labelledby="vision-recognition-settings-title">
      <header>
        <span className="desktop-image-generation-settings__icon"><Eye size={16} /></span>
        <div>
          <h3 id="vision-recognition-settings-title">{t('capabilities.vision.settings.title')}</h3>
          <p>{t('capabilities.vision.settings.description')}</p>
        </div>
      </header>

      <div className="desktop-image-generation-settings__form">
        <label className="desktop-image-generation-settings__field desktop-image-generation-settings__field--wide">
          <span>{t('capabilities.vision.settings.model')}</span>
          <SelectField
            aria-label={t('capabilities.vision.settings.model')}
            className="desktop-vision-recognition-settings__model-select"
            disabled={saving || testing || !config}
            value={selectedValue}
            onValueChange={(value) => void selectModel(value)}
          >
            <option value="">{t('capabilities.vision.settings.modelPlaceholder')}</option>
            {selectedValue && !selectionAvailable ? (
              <option value={selectedValue} disabled>{t('capabilities.vision.settings.modelUnavailable')}</option>
            ) : null}
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>
          <small>{t(options.length
            ? 'capabilities.vision.settings.modelHelp'
            : 'capabilities.vision.settings.modelEmpty')}</small>
        </label>
      </div>

      <div className="desktop-image-generation-settings__status" aria-live="polite">
        {error ? <span className="is-error">{error}</span> : null}
        {!error && saving ? <span><Loader2 className="is-spinning" size={13} /> {t('capabilities.common.saving')}</span> : null}
        {!error && !saving && saved ? <span className="is-success">{t('capabilities.vision.settings.saved')}</span> : null}
      </div>

      <VisionRecognitionPluginTest
        disabled={!selectionAvailable || saving}
        testing={testing}
        onAnalyze={(prompt) => runTest({ prompt })}
      />
    </section>
  );
}

function visionModelOptions(config: RuntimeConfigState | undefined): VisionModelOption[] {
  if (!config) return [];
  return config.providers.flatMap((provider) => {
    if (!provider.enabled) return [];
    return provider.models.flatMap((model) => {
      if (!model.enabled || !model.supportsImages || !model.id.trim() || !model.code.trim()) return [];
      const reference = { providerId: provider.id, modelId: model.id };
      const modelLabel = model.name && model.name !== model.code
        ? `${model.name} (${model.code})`
        : model.code;
      return [{
        label: `${provider.name || provider.id} · ${modelLabel}`,
        reference,
        value: configuredModelReferenceValue(reference),
      }];
    });
  });
}

function configuredModelReferenceValue(reference: RuntimeConfiguredModelReference | undefined): string {
  return reference ? JSON.stringify([reference.providerId, reference.modelId]) : '';
}

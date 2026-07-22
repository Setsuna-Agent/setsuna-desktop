import {
  normalizeImageGenerationServiceUrl,
  type RuntimeImageGenerationConfigInput,
  type RuntimeImageGenerationConfigState,
  type RuntimeImageGenerationTestInput,
  type RuntimeImageGenerationTestResult,
} from '@setsuna-desktop/contracts';
import { KeyRound, Loader2, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { Button, TextField } from '../../shared/ui/primitives.js';
import { ImageGenerationPluginTest } from './ImageGenerationPluginTest.js';

export function ImageGenerationPluginSettings({
  config,
  onSave,
  onTest,
}: {
  config?: RuntimeImageGenerationConfigState;
  onSave: (input: RuntimeImageGenerationConfigInput) => Promise<void>;
  onTest: (input: RuntimeImageGenerationTestInput) => Promise<RuntimeImageGenerationTestResult>;
}) {
  const { t } = useI18n();
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [model, setModel] = useState(config?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBaseUrl(config?.baseUrl ?? '');
    setModel(config?.model ?? '');
    setApiKey('');
    setClearApiKey(false);
  }, [config]);

  function configInput(requireUsableKey: boolean): RuntimeImageGenerationConfigInput {
    const normalizedUrl = normalizeImageGenerationServiceUrl(baseUrl);
    if (baseUrl.trim() && normalizedUrl === null) {
      throw new Error(t('capabilities.image.validation.url'));
    }
    if (!normalizedUrl) {
      throw new Error(t('capabilities.image.validation.baseUrl'));
    }
    const hasUsableKey = Boolean(apiKey.trim()) || Boolean(config?.apiKeySet && !clearApiKey);
    if ((requireUsableKey || !clearApiKey) && !hasUsableKey) {
      throw new Error(t('capabilities.image.validation.apiKey'));
    }
    return {
      baseUrl: normalizedUrl,
      model: model.trim(),
      apiKey: apiKey.trim() || undefined,
      clearApiKey,
    };
  }

  async function persistConfig(requireUsableKey: boolean) {
    await onSave(configInput(requireUsableKey));
    setApiKey('');
    setClearApiKey(false);
    setSaved(true);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await persistConfig(false);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSaving(false);
    }
  }

  async function generateTest(prompt: string): Promise<RuntimeImageGenerationTestResult> {
    setTesting(true);
    setError(null);
    setSaved(false);
    try {
      await persistConfig(true);
      return await onTest({ prompt });
    } finally {
      setTesting(false);
    }
  }

  const hasSavedKey = Boolean(config?.apiKeySet && !clearApiKey);
  const usesPlainHttp = baseUrl.trim().toLowerCase().startsWith('http://');
  const busy = saving || testing;

  return (
    <section className="desktop-image-generation-settings" aria-labelledby="image-generation-settings-title">
      <header>
        <span className="desktop-image-generation-settings__icon"><KeyRound size={16} /></span>
        <div>
          <h3 id="image-generation-settings-title">{t('capabilities.image.settings.title')}</h3>
          <p>{t('capabilities.image.settings.description')}</p>
        </div>
      </header>

      <div className="desktop-image-generation-settings__form">
        <label className="desktop-image-generation-settings__field desktop-image-generation-settings__field--wide">
          <span>{t('capabilities.image.settings.baseUrl')}</span>
          <TextField
            type="url"
            value={baseUrl}
            placeholder={t('capabilities.image.settings.baseUrlPlaceholder')}
            spellCheck={false}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setSaved(false);
            }}
          />
          <small>{t('capabilities.image.settings.baseUrlHelp')}</small>
        </label>

        <label className="desktop-image-generation-settings__field">
          <span>{t('capabilities.image.settings.model')}</span>
          <TextField
            value={model}
            placeholder={t('capabilities.image.settings.modelPlaceholder')}
            spellCheck={false}
            onChange={(event) => {
              setModel(event.target.value);
              setSaved(false);
            }}
          />
        </label>

        <label className="desktop-image-generation-settings__field">
          <span>API key</span>
          <TextField
            type="password"
            value={apiKey}
            autoComplete="new-password"
            placeholder={hasSavedKey ? config?.apiKeyPreview || t('capabilities.image.settings.keySaved') : t('capabilities.image.settings.keyPlaceholder')}
            spellCheck={false}
            onChange={(event) => {
              setApiKey(event.target.value);
              if (event.target.value) setClearApiKey(false);
              setSaved(false);
            }}
          />
        </label>
      </div>

      {usesPlainHttp ? (
        <p className="desktop-image-generation-settings__warning" role="note">
          {t('capabilities.image.settings.httpWarning')}
        </p>
      ) : null}

      <footer>
        <div className="desktop-image-generation-settings__status" aria-live="polite">
          {error ? <span className="is-error">{error}</span> : null}
          {!error && saved ? <span className="is-success">{t('capabilities.image.settings.saved')}</span> : null}
          {!error && !saved && clearApiKey ? <span>{t('capabilities.image.settings.clearPending')}</span> : null}
          {!error && !saved && hasSavedKey ? <span>{t('capabilities.image.settings.savedKey', { key: config?.apiKeyPreview ?? '' })}</span> : null}
        </div>
        {hasSavedKey ? (
          <Button
            type="button"
            variant="ghost"
            icon={<Trash2 size={14} />}
            disabled={busy}
            onClick={() => {
              setClearApiKey(true);
              setApiKey('');
              setSaved(false);
            }}
          >
            {t('capabilities.image.settings.clearKey')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="primary"
          icon={saving ? <Loader2 className="is-spinning" size={14} /> : <Save size={14} />}
          disabled={busy}
          onClick={() => void submit()}
        >
          {saving ? t('capabilities.common.saving') : t('capabilities.image.settings.save')}
        </Button>
      </footer>

      <ImageGenerationPluginTest generating={testing} onGenerate={generateTest} />
    </section>
  );
}

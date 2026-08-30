import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { Eye, Loader2, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  VISION_RECOGNITION_PROMPT_MAX_CHARS,
  type VisionRecognitionModelOption,
  type VisionRecognitionSettingsState,
  type VisionRecognitionTestResult,
} from '../contracts/index.js';
import type { VisionRecognitionClient } from './client.js';
import './vision-recognition.css';

export function VisionRecognitionSettingsView({
  client,
  translate,
  ui,
}: Readonly<{
  client: VisionRecognitionClient;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { SelectField } = ui;
  const [state, setState] = useState<VisionRecognitionSettingsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    void client.readSettings({ signal: abort.signal }).then(setState).catch((loadError: unknown) => {
      if (!abort.signal.aborted) setError(errorMessage(loadError));
    });
    return () => abort.abort();
  }, [client]);

  const selectedValue = referenceValue(state?.selection);
  const selectionAvailable = Boolean(
    selectedValue && state?.availableModels.some((option) => referenceValue(option) === selectedValue),
  );

  async function selectModel(value: string) {
    if (!state) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const selected = state.availableModels.find((option) => referenceValue(option) === value);
      const next = await client.updateSettings({
        expectedRevision: state.revision,
        selection: selected
          ? { providerId: selected.providerId, modelId: selected.modelId }
          : null,
      });
      setState(next);
      setSaved(true);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function runTest(prompt: string): Promise<VisionRecognitionTestResult> {
    setTesting(true);
    setError(null);
    try {
      return await client.testModel({ prompt });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section
      data-feature-id="vision-recognition"
      className="feature-vision-recognition-settings"
      aria-labelledby="feature-vision-recognition-title"
    >
      <header>
        <span className="feature-vision-recognition-settings__icon"><Eye size={16} /></span>
        <div>
          <h3 id="feature-vision-recognition-title">{translate('feature.visionRecognition.settings.title')}</h3>
          <p>{translate('feature.visionRecognition.settings.description')}</p>
        </div>
      </header>

      <label className="feature-vision-recognition-settings__field">
        <span>{translate('feature.visionRecognition.settings.model')}</span>
        <SelectField
          aria-label={translate('feature.visionRecognition.settings.model')}
          className="feature-vision-recognition-settings__select"
          disabled={saving || testing || !state}
          value={selectedValue}
          onValueChange={(value) => void selectModel(value)}
        >
          <option value="">{translate('feature.visionRecognition.settings.modelPlaceholder')}</option>
          {selectedValue && !selectionAvailable ? (
            <option value={selectedValue} disabled>
              {translate('feature.visionRecognition.settings.modelUnavailable')}
            </option>
          ) : null}
          {state?.availableModels.map((option) => (
            <option key={referenceValue(option)} value={referenceValue(option)}>
              {modelOptionLabel(option)}
            </option>
          ))}
        </SelectField>
        <small>{translate(state?.availableModels.length
          ? 'feature.visionRecognition.settings.modelHelp'
          : 'feature.visionRecognition.settings.modelEmpty')}</small>
      </label>

      <div className="feature-vision-recognition-settings__status" aria-live="polite">
        {error ? <span className="is-error">{error}</span> : null}
        {!error && saving ? <span><Loader2 className="is-spinning" size={13} /> {translate('feature.visionRecognition.settings.saving')}</span> : null}
        {!error && !saving && saved ? <span className="is-success">{translate('feature.visionRecognition.settings.saved')}</span> : null}
      </div>

      <VisionRecognitionTestView
        disabled={!selectionAvailable || saving}
        testing={testing}
        translate={translate}
        ui={ui}
        onAnalyze={runTest}
      />
    </section>
  );
}

function VisionRecognitionTestView({
  disabled,
  testing,
  translate,
  ui,
  onAnalyze,
}: Readonly<{
  disabled: boolean;
  testing: boolean;
  translate: RendererTranslate;
  ui: SettingsViewUi;
  onAnalyze(prompt: string): Promise<VisionRecognitionTestResult>;
}>) {
  const { Button, TextArea } = ui;
  const [prompt, setPrompt] = useState(() => translate('feature.visionRecognition.test.promptDefault'));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VisionRecognitionTestResult | null>(null);

  async function analyze() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setError(translate('feature.visionRecognition.test.promptRequired'));
      return;
    }
    setError(null);
    try {
      setResult(await onAnalyze(normalizedPrompt));
    } catch (testError) {
      setError(errorMessage(testError));
    }
  }

  return (
    <section className="feature-vision-recognition-test" aria-labelledby="feature-vision-recognition-test-title">
      <header>
        <div>
          <h4 id="feature-vision-recognition-test-title">{translate('feature.visionRecognition.test.title')}</h4>
          <p>{translate('feature.visionRecognition.test.description')}</p>
        </div>
        <span>{translate('feature.visionRecognition.test.badge')}</span>
      </header>

      <label className="feature-vision-recognition-test__prompt">
        <span>{translate('feature.visionRecognition.test.prompt')}</span>
        <TextArea
          className="feature-vision-recognition-test__textarea"
          rows={3}
          maxLength={VISION_RECOGNITION_PROMPT_MAX_CHARS}
          value={prompt}
          disabled={disabled || testing}
          onChange={(event) => {
            setPrompt(event.currentTarget.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              if (!disabled && !testing) void analyze();
            }
          }}
        />
      </label>

      <div className="feature-vision-recognition-test__controls">
        <div className="feature-vision-recognition-test__status" aria-live="polite">
          {error ? <span className="is-error">{error}</span> : null}
          {!error && testing ? <span>{translate('feature.visionRecognition.test.testingStatus')}</span> : null}
          {!error && !testing && result ? (
            <span className="is-success">
              {translate('feature.visionRecognition.test.success', { duration: formatDuration(result.durationMs) })}
              {result.model ? ` · ${result.model}` : ''}
            </span>
          ) : null}
          {!error && !testing && !result ? <span>{translate('feature.visionRecognition.test.shortcut')}</span> : null}
        </div>
        <Button
          disabled={disabled || testing || !prompt.trim()}
          icon={testing ? <Loader2 className="is-spinning" size={14} /> : <Play size={14} />}
          variant="primary"
          onClick={() => void analyze()}
        >
          {translate(testing ? 'feature.visionRecognition.test.testing' : 'feature.visionRecognition.test.run')}
        </Button>
      </div>

      {result ? (
        <pre className="feature-vision-recognition-test__result" aria-label={translate('feature.visionRecognition.test.result')}>
          {result.content}
        </pre>
      ) : null}
    </section>
  );
}

function referenceValue(reference: Readonly<{ providerId: string; modelId: string }> | null | undefined): string {
  return reference ? JSON.stringify([reference.providerId, reference.modelId]) : '';
}

function modelOptionLabel(option: VisionRecognitionModelOption): string {
  const model = option.modelName && option.modelName !== option.modelCode
    ? `${option.modelName} (${option.modelCode})`
    : option.modelCode;
  return `${option.providerName} · ${model}`;
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000
    ? `${durationMs} ms`
    : `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

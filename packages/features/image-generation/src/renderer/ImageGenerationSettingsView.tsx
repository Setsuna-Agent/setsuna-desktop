import type {
  RuntimeGeneratedMessageAttachment } from '@setsuna-desktop/contracts';
import type { RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { Image } from 'antd';
import { Copy, FolderOpen, KeyRound, Loader2, Play, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS,
  normalizeImageGenerationServiceUrl,
  type ImageGenerationRendererAssets,
  type ImageGenerationSettingsState,
  type ImageGenerationTestResult,
} from '../contracts/index.js';
import type { ImageGenerationClient } from './client.js';
import './image-generation.css';

export function ImageGenerationSettingsView({
  assets,
  client,
  translate,
  ui,
}: Readonly<{
  assets: ImageGenerationRendererAssets;
  client: ImageGenerationClient;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { Button, TextField } = ui;
  const [state, setState] = useState<ImageGenerationSettingsState | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    void client.readSettings({ signal: abort.signal }).then((next) => {
      setState(next);
      setBaseUrl(next.value.baseUrl);
      setModel(next.value.model);
    }).catch((loadError: unknown) => {
      if (!abort.signal.aborted) setError(errorMessage(loadError));
    });
    return () => abort.abort();
  }, [client]);

  async function persist(requireUsableKey: boolean): Promise<ImageGenerationSettingsState> {
    if (!state) throw new Error(translate('feature.imageGeneration.settings.validation.notLoaded'));
    const normalizedUrl = normalizeImageGenerationServiceUrl(baseUrl);
    if (baseUrl.trim() && normalizedUrl === null) {
      throw new Error(translate('feature.imageGeneration.settings.validation.invalidUrl'));
    }
    if (!normalizedUrl) throw new Error(translate('feature.imageGeneration.settings.validation.missingUrl'));
    const hasUsableKey = Boolean(apiKey.trim()) || Boolean(state.value.apiKeySet && !clearApiKey);
    if ((requireUsableKey || !clearApiKey) && !hasUsableKey) {
      throw new Error(translate('feature.imageGeneration.settings.validation.missingKey'));
    }
    const next = await client.updateSettings({
      expectedRevision: state.revision,
      patch: { baseUrl: normalizedUrl, model: model.trim() },
      secretPatch: { apiKey: apiKey.trim(), clearApiKey },
    });
    setState(next);
    setApiKey('');
    setClearApiKey(false);
    setSaved(true);
    return next;
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await persist(false);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function test(prompt: string): Promise<ImageGenerationTestResult> {
    setTesting(true);
    setError(null);
    setSaved(false);
    try {
      await persist(true);
      return await client.testConnection({ prompt });
    } finally {
      setTesting(false);
    }
  }

  const hasSavedKey = Boolean(state?.value.apiKeySet && !clearApiKey);
  const busy = saving || testing;
  return (
    <section data-feature-id="image-generation" className="feature-image-generation-settings" aria-labelledby="feature-image-generation-title">
      <header>
        <span className="feature-image-generation-settings__icon"><KeyRound size={16} /></span>
        <div>
          <h3 id="feature-image-generation-title">{translate('feature.imageGeneration.settings.title')}</h3>
          <p>{translate('feature.imageGeneration.settings.description')}</p>
        </div>
      </header>

      <div className="feature-image-generation-settings__form">
        <label className="feature-image-generation-settings__field feature-image-generation-settings__field--wide">
          <span>{translate('feature.imageGeneration.settings.baseUrl')}</span>
          <TextField
            className="feature-image-generation-settings__input"
            type="url"
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
            onChange={(event) => { setBaseUrl(event.target.value); setSaved(false); }}
          />
        </label>
        <label className="feature-image-generation-settings__field">
          <span>{translate('feature.imageGeneration.settings.model')}</span>
          <TextField
            className="feature-image-generation-settings__input"
            value={model}
            placeholder="gpt-image-1"
            spellCheck={false}
            onChange={(event) => { setModel(event.target.value); setSaved(false); }}
          />
        </label>
        <label className="feature-image-generation-settings__field">
          <span>{translate('feature.imageGeneration.settings.apiKey')}</span>
          <TextField
            className="feature-image-generation-settings__input"
            type="password"
            value={apiKey}
            autoComplete="new-password"
            placeholder={hasSavedKey
              ? state?.value.apiKeyPreview || translate('feature.imageGeneration.settings.apiKeySaved')
              : translate('feature.imageGeneration.settings.apiKeyPlaceholder')}
            spellCheck={false}
            onChange={(event) => { setApiKey(event.target.value); if (event.target.value) setClearApiKey(false); setSaved(false); }}
          />
        </label>
      </div>

      {baseUrl.trim().toLowerCase().startsWith('http://') ? (
        <p className="feature-image-generation-settings__warning">
          {translate('feature.imageGeneration.settings.httpWarning')}
        </p>
      ) : null}
      <footer>
        <div className="feature-image-generation-settings__status" aria-live="polite">
          {error ? <span className="is-error">{error}</span> : null}
          {!error && saved ? (
            <span className="is-success">{translate('feature.imageGeneration.settings.saved')}</span>
          ) : null}
          {!error && !saved && state?.health !== 'ready' ? (
            <span>{translate('feature.imageGeneration.settings.currentHealth', {
              health: healthLabel(state?.health, translate),
            })}</span>
          ) : null}
        </div>
        {hasSavedKey ? (
          <Button
            disabled={busy}
            icon={<Trash2 size={14} />}
            variant="danger"
            onClick={() => { setClearApiKey(true); setApiKey(''); setSaved(false); }}
          >
            {translate('feature.imageGeneration.settings.clearKey')}
          </Button>
        ) : null}
        <Button
          disabled={busy || !state}
          icon={saving ? <Loader2 className="is-spinning" size={14} /> : <Save size={14} />}
          variant="primary"
          onClick={() => void save()}
        >
          {translate('feature.imageGeneration.settings.save')}
        </Button>
      </footer>

      <ImageGenerationConnectionTest
        assets={assets}
        generating={testing}
        onGenerate={test}
        translate={translate}
        ui={ui}
      />
    </section>
  );
}

function ImageGenerationConnectionTest({
  assets,
  generating,
  onGenerate,
  translate,
  ui,
}: Readonly<{
  assets: ImageGenerationRendererAssets;
  generating: boolean;
  onGenerate(prompt: string): Promise<ImageGenerationTestResult>;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { Button, TextArea } = ui;
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImageGenerationTestResult | null>(null);
  async function generate() {
    if (!prompt.trim()) {
      setError(translate('feature.imageGeneration.test.promptRequired'));
      return;
    }
    setError(null);
    try { setResult(await onGenerate(prompt.trim())); }
    catch (generationError) { setError(errorMessage(generationError)); }
  }
  return (
    <section className="feature-image-generation-test" aria-labelledby="feature-image-generation-test-title">
      <header><div><h4 id="feature-image-generation-test-title">{translate('feature.imageGeneration.test.title')}</h4><p>{translate('feature.imageGeneration.test.description')}</p></div><span>{translate('feature.imageGeneration.test.badge')}</span></header>
      <label className="feature-image-generation-test__prompt">
        <span>{translate('feature.imageGeneration.test.prompt')}</span>
        <TextArea
          className="feature-image-generation-test__textarea"
          rows={4}
          maxLength={IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS}
          value={prompt}
          disabled={generating}
          placeholder={translate('feature.imageGeneration.test.promptPlaceholder')}
          onChange={(event) => { setPrompt(event.currentTarget.value); setError(null); }}
          onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!generating) void generate(); } }}
        />
      </label>
      <div className="feature-image-generation-test__controls">
        <div aria-live="polite">{error ? <span className="is-error">{error}</span> : result ? <span className="is-success">{translate('feature.imageGeneration.test.generated', { count: result.images.length, duration: formatDuration(result.durationMs) })}</span> : <span>{translate('feature.imageGeneration.test.shortcut')}</span>}</div>
        <Button
          disabled={generating || !prompt.trim()}
          icon={generating ? <Loader2 className="is-spinning" size={14} /> : <Play size={14} />}
          variant="primary"
          onClick={() => void generate()}
        >
          {translate('feature.imageGeneration.test.generate')}
        </Button>
      </div>
      {result?.images.length ? <Image.PreviewGroup><div className="feature-image-generation-test__results">{result.images.map((attachment) => <QuickTestImage assets={assets} attachment={attachment} key={attachment.assetId} translate={translate} ui={ui} />)}</div></Image.PreviewGroup> : null}
    </section>
  );
}

function QuickTestImage({ assets, attachment, translate, ui }: Readonly<{
  assets: ImageGenerationRendererAssets;
  attachment: RuntimeGeneratedMessageAttachment;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { Button } = ui;
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void assets.read(attachment.assetId).then((result) => {
      if (!active) return;
      if (!result.ok) { setError(result.error); return; }
      objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(result.data)], { type: result.type }));
      setSource(objectUrl);
    }).catch((readError: unknown) => { if (active) setError(errorMessage(readError)); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assets, attachment.assetId]);
  async function action(kind: 'copy' | 'reveal') {
    const result = await assets[kind]({ assetId: attachment.assetId, name: attachment.name });
    if (!result.ok) setError(result.error);
  }
  return (
    <article className="feature-image-generation-test__image">
      <div className="feature-image-generation-test__preview">{source ? <Image src={source} alt={attachment.name} /> : <div role={error ? 'alert' : 'status'}>{error ?? translate('feature.imageGeneration.test.loading')}</div>}</div>
      <div className="feature-image-generation-test__image-footer">
        <span>{attachment.name}</span>
        <div>
          <Button icon={<Copy size={13} />} variant="ghost" onClick={() => void action('copy')}>
            {translate('feature.imageGeneration.test.copy')}
          </Button>
          <Button icon={<FolderOpen size={13} />} variant="ghost" onClick={() => void action('reveal')}>
            {translate('feature.imageGeneration.test.reveal')}
          </Button>
        </div>
      </div>
    </article>
  );
}

function healthLabel(
  health: ImageGenerationSettingsState['health'] | undefined,
  translate: RendererTranslate,
): string {
  if (health === 'not-configured') return translate('feature.imageGeneration.settings.health.notConfigured');
  if (health === 'credentials-missing') return translate('feature.imageGeneration.settings.health.credentialsMissing');
  if (health === 'provider-unavailable') return translate('feature.imageGeneration.settings.health.providerUnavailable');
  if (health === 'settings-invalid') return translate('feature.imageGeneration.settings.health.settingsInvalid');
  return translate('feature.imageGeneration.settings.health.ready');
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

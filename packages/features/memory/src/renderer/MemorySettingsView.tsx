import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { ArrowLeft, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  MemoryModelOption,
  MemoryPreferencesPatch,
  MemorySettingsState,
  RuntimeMemoryPreview,
  RuntimeMemoryPreviewItem,
} from '../contracts/index.js';
import type { MemoryClient } from './client.js';
import './memory.css';

type MemorySettingsViewProps = Readonly<{
  client: MemoryClient;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>;

export function MemoryPreferencesSettingsView({
  client,
  onOpenPreview,
  translate,
  ui,
}: MemorySettingsViewProps & Readonly<{ onOpenPreview(): void }>) {
  const { Group, NavigationRow, Section, Toggle } = ui;
  const settings = useMemorySettings(client);

  return (
    <Section className="feature-memory" featureId="memory">
      <Group title={translate('feature.memory.settings.title')}>
        <Toggle
          checked={settings.state?.value.useMemories ?? false}
          disabled={settings.busy || !settings.state}
          label={translate('feature.memory.settings.use')}
          description={translate('feature.memory.settings.useDescription')}
          onChange={(useMemories) => void settings.save({ useMemories })}
        />
        <Toggle
          checked={settings.state?.value.generateMemories ?? false}
          disabled={settings.busy || !settings.state}
          label={translate('feature.memory.settings.generate')}
          description={translate('feature.memory.settings.generateDescription')}
          onChange={(generateMemories) => void settings.save({ generateMemories })}
        />
        <Toggle
          checked={settings.state?.value.disableOnExternalContext ?? false}
          disabled={settings.busy || !settings.state}
          label={translate('feature.memory.settings.external')}
          description={translate('feature.memory.settings.externalDescription')}
          onChange={(disableOnExternalContext) => void settings.save({ disableOnExternalContext })}
        />
        <NavigationRow
          actionLabel={translate('feature.memory.settings.view')}
          label={translate('feature.memory.settings.preview')}
          onClick={onOpenPreview}
        />
      </Group>
      {settings.error ? (
        <p className="feature-memory__error" role="alert">{settings.error}</p>
      ) : null}
    </Section>
  );
}

export function MemoryPreviewSettingsView({
  client,
  onBack,
  translate,
  ui,
}: MemorySettingsViewProps & Readonly<{ onBack(): void }>) {
  const { Button, EmptyState, Section } = ui;
  const [preview, setPreview] = useState<RuntimeMemoryPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      setPreview(await client.preview());
    } catch (error) {
      setPreviewError(errorMessage(error));
    } finally {
      setPreviewBusy(false);
    }
  }, [client]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  async function deleteItem(memoryId: string) {
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      await client.delete(memoryId);
      setPreview(await client.preview());
    } catch (error) {
      setPreviewError(errorMessage(error));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function clear() {
    if (!window.confirm(translate('feature.memory.settings.resetConfirm'))) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      await client.clear();
      setPreview(await client.preview());
    } catch (error) {
      setPreviewError(errorMessage(error));
    } finally {
      setPreviewBusy(false);
    }
  }

  return (
    <Section className="feature-memory feature-memory--preview" featureId="memory">
      <div className="feature-memory__toolbar">
        <Button
          icon={<ArrowLeft size={14} />}
          variant="ghost"
          onClick={onBack}
        >
          {translate('feature.memory.settings.back')}
        </Button>
        <Button
          disabled={previewBusy}
          icon={previewBusy
            ? <Loader2 className="is-spinning" size={14} />
            : <RefreshCw size={14} />}
          onClick={() => void loadPreview()}
        >
          {translate(previewBusy ? 'feature.memory.settings.refreshing' : 'feature.memory.settings.refresh')}
        </Button>
      </div>
      <header className="feature-memory__preview-heading">
        <div>
          <h2>{translate('feature.memory.settings.preview')}</h2>
          <p>{translate('feature.memory.settings.previewDescription')}</p>
        </div>
        <strong>{translate('feature.memory.settings.previewCount', { count: preview?.total ?? 0 })}</strong>
      </header>
      {previewError ? <p className="feature-memory__error" role="alert">{previewError}</p> : null}
      <div className="feature-memory__list">
        {preview?.items.map((item) => (
          <MemoryPreviewCard
            key={item.id}
            item={item}
            disabled={previewBusy}
            translate={translate}
            ui={ui}
            onDelete={deleteItem}
          />
        ))}
        {!previewBusy && !preview?.items.length ? (
          <EmptyState title={translate('feature.memory.settings.empty')} />
        ) : null}
      </div>
      <div className="feature-memory__danger-zone">
        <Button
          disabled={previewBusy}
          icon={<Trash2 size={14} />}
          variant="danger"
          onClick={() => void clear()}
        >
          {translate('feature.memory.settings.reset')}
        </Button>
      </div>
    </Section>
  );
}

export function MemoryTaskModelSettingsView({
  client,
  translate,
  ui,
}: MemorySettingsViewProps) {
  const { Group, Section } = ui;
  const settings = useMemorySettings(client);
  const modelOptions = settings.state?.availableModels ?? [];
  const noModelsAvailable = Boolean(settings.state && modelOptions.length === 0);

  return (
    <Section className="feature-memory" featureId="memory">
      <Group title={translate('feature.memory.settings.title')}>
        <MemoryModelSelect
          label={translate('feature.memory.settings.extractionModel')}
          description={translate('feature.memory.settings.extractionModelDescription')}
          fallback={translate('feature.memory.settings.followConversation')}
          noModelsAvailable={noModelsAvailable}
          options={modelOptions}
          value={settings.state?.value.extractionModel ?? null}
          disabled={settings.busy || !settings.state}
          translate={translate}
          ui={ui}
          onChange={(extractionModel) => void settings.save({ extractionModel })}
        />
        <MemoryModelSelect
          label={translate('feature.memory.settings.consolidationModel')}
          description={translate('feature.memory.settings.consolidationModelDescription')}
          fallback={translate('feature.memory.settings.followProvider')}
          noModelsAvailable={noModelsAvailable}
          options={modelOptions}
          value={settings.state?.value.consolidationModel ?? null}
          disabled={settings.busy || !settings.state}
          translate={translate}
          ui={ui}
          onChange={(consolidationModel) => void settings.save({ consolidationModel })}
        />
      </Group>
      {settings.error ? (
        <p className="feature-memory__error" role="alert">{settings.error}</p>
      ) : null}
    </Section>
  );
}

function useMemorySettings(client: MemoryClient) {
  const [state, setState] = useState<MemorySettingsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void client.readSettings({ signal: abort.signal }).then(setState).catch((loadError: unknown) => {
      if (!abort.signal.aborted) setError(errorMessage(loadError));
    });
    return () => abort.abort();
  }, [client]);

  async function save(patch: MemoryPreferencesPatch) {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      setState(await client.updateSettings({ expectedRevision: state.revision, patch }));
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, save, state };
}

function MemoryModelSelect({
  description,
  disabled,
  fallback,
  label,
  noModelsAvailable,
  onChange,
  options,
  translate,
  ui,
  value,
}: Readonly<{
  description: string;
  disabled: boolean;
  fallback: string;
  label: string;
  noModelsAvailable: boolean;
  onChange(value: Readonly<{ providerId: string; modelId: string }> | null): void;
  options: readonly MemoryModelOption[];
  translate: RendererTranslate;
  ui: SettingsViewUi;
  value: Readonly<{ providerId: string; modelId: string }> | null;
}>) {
  const { Row, SelectField } = ui;
  const selected = referenceValue(value);
  const available = !selected || options.some((option) => referenceValue(option) === selected);
  return (
    <Row
      label={label}
      description={noModelsAvailable
        ? `${description} ${translate('feature.memory.settings.modelEmpty')}`
        : description}
    >
      <SelectField
        aria-label={label}
        disabled={disabled}
        value={selected}
        onValueChange={(nextValue) => {
          const option = options.find((candidate) => referenceValue(candidate) === nextValue);
          onChange(option ? { providerId: option.providerId, modelId: option.modelId } : null);
        }}
      >
        <option value="">{fallback}</option>
        {!available ? (
          <option value={selected} disabled>
            {translate('feature.memory.settings.modelUnavailable')}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={referenceValue(option)} value={referenceValue(option)}>
            {option.providerName} · {option.modelName || option.modelCode}
          </option>
        ))}
      </SelectField>
    </Row>
  );
}

function MemoryPreviewCard({
  disabled,
  item,
  onDelete,
  translate,
  ui,
}: Readonly<{
  disabled: boolean;
  item: RuntimeMemoryPreviewItem;
  onDelete(memoryId: string): Promise<void>;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const { IconButton } = ui;
  const scope = item.scope === 'global'
    ? translate('feature.memory.settings.scopeGlobal')
    : translate('feature.memory.settings.scopeProject', { project: item.projectId ?? '—' });
  const origin = translate(item.origin === 'active'
    ? 'feature.memory.settings.originActive'
    : 'feature.memory.settings.originPassive');
  return (
    <article className="feature-memory__item">
      <div className="feature-memory__item-heading">
        <strong>{item.title}</strong>
        <span>{scope} · {origin}</span>
      </div>
      <IconButton
        className="feature-memory__item-delete"
        label={translate('feature.memory.settings.delete')}
        variant="danger"
        disabled={disabled}
        onClick={() => void onDelete(item.id)}
      >
        <Trash2 size={14} />
      </IconButton>
      <pre>{item.preview}</pre>
    </article>
  );
}

function referenceValue(reference: Readonly<{ providerId: string; modelId: string }> | null): string {
  return reference ? JSON.stringify([reference.providerId, reference.modelId]) : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

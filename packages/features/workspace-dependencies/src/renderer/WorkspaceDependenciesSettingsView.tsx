import type {
  RendererTranslate,
  SettingsViewUi,
} from '@setsuna-desktop/feature-core/renderer';
import {
  CircleGauge,
  Code2,
  Package,
  Pencil,
  RefreshCw,
  RotateCcw,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  DEFAULT_NPM_REGISTRY_URL,
  DEFAULT_PYTHON_PACKAGE_INDEX_URL,
  normalizeNpmRegistryUrl,
  normalizePythonPackageIndexUrl,
  type RuntimeWorkspaceDependenciesStatus,
} from '../contracts/index.js';
import type { WorkspaceDependenciesClient } from './client.js';
import { useWorkspaceDependencies } from './controller.js';
import { planPackageSourceSave } from './package-source-save.js';
import './workspace-dependencies.css';

type WorkspaceDependenciesSettingsViewProps = Readonly<{
  client: WorkspaceDependenciesClient;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>;

export function WorkspaceDependenciesSettingsView({
  client,
  translate,
  ui,
}: WorkspaceDependenciesSettingsViewProps) {
  const dependencies = useWorkspaceDependencies(client);
  const settings = dependencies.settings?.value;
  const busy = dependencies.busyAction !== null;
  const environmentReady = dependencies.status?.state === 'ready';
  const { Button, Group, Row, Section, Tooltip } = ui;

  return (
    <Section className="feature-workspace-dependencies" featureId="workspace-dependencies">
      <Group title={translate('feature.workspaceDependencies.settings.title')}>
        <PackageSourceForm
          defaultValue={DEFAULT_NPM_REGISTRY_URL}
          disabled={busy || !settings}
          id="workspace-npm-registry"
          icon={<Package size={15} />}
          label={translate('feature.workspaceDependencies.settings.npmSource')}
          normalize={normalizeNpmRegistryUrl}
          translate={translate}
          ui={ui}
          value={settings?.npmRegistryUrl ?? DEFAULT_NPM_REGISTRY_URL}
          onPersist={(npmRegistryUrl) => dependencies.save({ npmRegistryUrl })}
        />
        <PackageSourceForm
          defaultValue={DEFAULT_PYTHON_PACKAGE_INDEX_URL}
          disabled={busy || !settings}
          id="workspace-python-package-index"
          icon={<Code2 size={15} />}
          label={translate('feature.workspaceDependencies.settings.pythonSource')}
          normalize={normalizePythonPackageIndexUrl}
          translate={translate}
          ui={ui}
          value={settings?.pythonPackageIndexUrl ?? DEFAULT_PYTHON_PACKAGE_INDEX_URL}
          onPersist={(pythonPackageIndexUrl) => dependencies.save({ pythonPackageIndexUrl })}
        />
        <Row
          className="feature-workspace-dependencies__status-row"
          icon={<CircleGauge size={16} />}
          label={(
            <span className="feature-workspace-dependencies__environment-heading">
              <span>{translate('feature.workspaceDependencies.settings.environment')}</span>
              <EnvironmentStatusIndicator
                error={dependencies.error}
                status={dependencies.status}
                translate={translate}
              />
            </span>
          )}
        >
          <div className="feature-workspace-dependencies__actions">
            <Button
              icon={dependencies.busyAction === 'diagnose'
                ? <RefreshCw className="is-spinning" size={14} />
                : <RefreshCw size={14} />}
              disabled={busy}
              onClick={() => void dependencies.diagnose()}
            >
              {translate(dependencies.busyAction === 'diagnose'
                ? 'feature.workspaceDependencies.settings.checking'
                : 'feature.workspaceDependencies.settings.check')}
            </Button>
            <Tooltip title={translate('feature.workspaceDependencies.settings.repairDescription')}>
              <span className="feature-workspace-dependencies__repair-tooltip-target">
                <Button
                  icon={dependencies.busyAction === 'repair'
                    ? <RefreshCw className="is-spinning" size={14} />
                    : <Wrench size={14} />}
                  disabled={busy || environmentReady}
                  onClick={() => void dependencies.repair()}
                >
                  {translate(dependencies.busyAction === 'repair'
                    ? 'feature.workspaceDependencies.settings.repairing'
                    : 'feature.workspaceDependencies.settings.repair')}
                </Button>
              </span>
            </Tooltip>
          </div>
        </Row>
      </Group>
      {dependencies.error ? (
        <p className="feature-workspace-dependencies__error" role="alert">{dependencies.error}</p>
      ) : null}
    </Section>
  );
}

function PackageSourceForm({
  defaultValue,
  disabled,
  id,
  icon,
  label,
  normalize,
  onPersist,
  translate,
  ui,
  value,
}: Readonly<{
  defaultValue: string;
  disabled: boolean;
  id: string;
  icon: ReactNode;
  label: string;
  normalize: (value: unknown) => string | null;
  onPersist(value: string): Promise<boolean>;
  translate: RendererTranslate;
  ui: SettingsViewUi;
  value: string;
}>) {
  const { IconButton, Row, TextField } = ui;
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const errorId = `${id}-error`;
  const customized = value !== defaultValue;

  useEffect(() => {
    setDraft(value);
    setError(null);
    setEditing(false);
  }, [value]);

  const save = async (nextValue: string) => {
    const plan = planPackageSourceSave({
      defaultValue,
      draft: nextValue,
      effectiveValue: value,
      normalize,
    });
    if (plan.kind === 'invalid') {
      setError(translate('feature.workspaceDependencies.settings.invalidSource'));
      return;
    }
    if (plan.kind === 'unchanged') {
      setDraft(plan.displayValue);
      setEditing(false);
      setError(null);
      return;
    }
    setError(null);
    if (await onPersist(plan.persistedValue)) {
      setDraft(plan.displayValue);
      setEditing(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(draft);
  };

  const cancelEditing = () => {
    if (disabled) return;
    setDraft(value);
    setError(null);
    setEditing(false);
  };

  return (
    <Row
      className="feature-workspace-dependencies__source-row"
      icon={icon}
      label={label}
    >
      <form noValidate onSubmit={submit}>
        {editing ? (
          <div className="feature-workspace-dependencies__source-editor">
            <TextField
              autoFocus
              id={id}
              aria-label={label}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? 'true' : undefined}
              disabled={disabled}
              inputMode="url"
              spellCheck={false}
              value={draft}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                cancelEditing();
              }}
            />
            <IconButton
              label={translate(disabled
                ? 'feature.workspaceDependencies.settings.saving'
                : 'feature.workspaceDependencies.settings.cancel')}
              variant="ghost"
              disabled={disabled}
              onClick={cancelEditing}
            >
              {disabled ? <RefreshCw className="is-spinning" size={13} /> : <X size={13} />}
            </IconButton>
          </div>
        ) : (
          <div className="feature-workspace-dependencies__source-display">
            <code title={value}>{value}</code>
            <IconButton
              label={translate('feature.workspaceDependencies.settings.editSource', { source: label })}
              disabled={disabled}
              onClick={() => {
                setDraft(value);
                setError(null);
                setEditing(true);
              }}
            >
              <Pencil size={13} />
            </IconButton>
            {customized ? (
              <IconButton
                label={translate('feature.workspaceDependencies.settings.resetSource', { source: label })}
                variant="ghost"
                disabled={disabled}
                onClick={() => void save(defaultValue)}
              >
                {disabled ? <RefreshCw className="is-spinning" size={13} /> : <RotateCcw size={13} />}
              </IconButton>
            ) : null}
          </div>
        )}
        {error ? <small id={errorId} role="alert">{error}</small> : null}
      </form>
    </Row>
  );
}

function EnvironmentStatusIndicator({
  error,
  status,
  translate,
}: Readonly<{
  error: string | null;
  status: RuntimeWorkspaceDependenciesStatus | null;
  translate: RendererTranslate;
}>) {
  const state = environmentStatusIndicatorState(status, Boolean(error));
  const label = translate(state.messageKey);
  const details = error ?? status?.checks.map((check) => check.message).join('\n');
  const title = details ? `${label}\n${details}` : label;
  return (
    <span
      aria-label={label}
      className={`feature-workspace-dependencies__status is-${state.tone}`}
      role="status"
      title={title}
    />
  );
}

function environmentStatusIndicatorState(
  status: RuntimeWorkspaceDependenciesStatus | null,
  requestFailed: boolean,
): Readonly<{
  messageKey:
    | 'feature.workspaceDependencies.settings.status.available'
    | 'feature.workspaceDependencies.settings.status.checking'
    | 'feature.workspaceDependencies.settings.status.failed'
    | 'feature.workspaceDependencies.settings.status.installing'
    | 'feature.workspaceDependencies.settings.status.unavailable';
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}> {
  if (requestFailed || status?.state === 'error') {
    return { messageKey: 'feature.workspaceDependencies.settings.status.failed', tone: 'danger' };
  }
  if (status?.state === 'installing') {
    return { messageKey: 'feature.workspaceDependencies.settings.status.installing', tone: 'warning' };
  }
  if (!status) return { messageKey: 'feature.workspaceDependencies.settings.status.checking', tone: 'neutral' };
  if (status.state === 'ready') {
    return { messageKey: 'feature.workspaceDependencies.settings.status.available', tone: 'success' };
  }
  return { messageKey: 'feature.workspaceDependencies.settings.status.unavailable', tone: 'warning' };
}

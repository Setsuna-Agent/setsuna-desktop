import { validPluginUiScalarValue } from '@setsuna-desktop/contracts';
import { Switch, TextField as UiTextField, SelectField as UiSelectField, Button as UiButton, ToastNotice } from '@setsuna-desktop/renderer-ui';

import type {
  RuntimePluginUiAction,
  RuntimePluginUiActionInput,
  RuntimePluginUiTreeContribution,
  RuntimePluginUiData,
  RuntimePluginUiManifest,
  RuntimePluginUiNode,
} from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import {
  resolveRuntimePluginUiText,
  useDeclarativePluginUiData,
} from './useDeclarativePluginUiData.js';
import { PluginSecretField } from './PluginSecretField.js';

type ActionState =
  | Readonly<{ state: 'idle' }>
  | Readonly<{ actionId: string; state: 'confirming' | 'running' | 'completed' }>
  | Readonly<{ actionId: string; reason: 'action' | 'required'; state: 'error' }>;

type HydrationState = 'loading' | 'ready' | 'error';

type DeclarativePluginUiViewProps = Readonly<{
  contribution: RuntimePluginUiTreeContribution;
  cwd?: string;
  manifest: RuntimePluginUiManifest;
  pluginId: string;
  projectId?: string;
  service: PluginManagementRendererService;
  settingsUi?: SettingsViewUi;
  threadId?: string;
  translate?: RendererTranslate;
}>;

export function DeclarativePluginUiView(props: DeclarativePluginUiViewProps) {
  const { contribution, pluginId, projectId, threadId } = props;
  const instanceKey = `${pluginId}\u0000${contribution.id}\u0000${projectId ?? ''}\u0000${threadId ?? ''}`;

  // A scope change represents a different Plugin UI instance. Remounting keeps
  // form drafts and in-flight actions from crossing project/thread boundaries.
  return <DeclarativePluginUiViewInstance key={instanceKey} {...props} />;
}

function DeclarativePluginUiViewInstance({
  contribution,
  cwd,
  manifest,
  pluginId,
  projectId,
  service,
  settingsUi,
  threadId,
  translate,
}: DeclarativePluginUiViewProps) {
  const { t } = useI18n();
  const translateFeature: RendererTranslate = translate ?? t;
  const { id: contributionId, stateKey, tree: node } = contribution;
  const dataState = useDeclarativePluginUiData({
    contribution,
    pluginId,
    projectId,
    service,
    threadId,
  });
  const initialValues = useMemo(
    () => collectInitialValues(contribution.tree, dataState.data),
    [contribution.tree, dataState.data],
  );
  const [values, setValues] = useState<Readonly<Record<string, string>>>(initialValues);
  const [secretChanges, setSecretChanges] = useState<Readonly<Record<string, string | null>>>({});
  const dirtyFields = useRef(new Set<string>());
  const [hydrationState, setHydrationState] = useState<HydrationState>(stateKey ? 'loading' : 'ready');
  const [actionState, setActionState] = useState<ActionState>({ state: 'idle' });
  const actionController = useRef<AbortController | null>(null);
  const actions = useMemo(() => new Map(manifest.actions.map((action) => [action.id, action])), [manifest]);
  useEffect(() => {
    setValues((current) => Object.freeze(Object.fromEntries(Object.entries(initialValues).map(([name, value]) => [
      name,
      dirtyFields.current.has(name) ? current[name] ?? value : value,
    ]))));
  }, [initialValues]);

  useEffect(() => {
    const controller = new AbortController();
    if (!stateKey) {
      setHydrationState('ready');
      return () => controller.abort();
    }
    setHydrationState('loading');
    void service.readRendererUiState(
      { pluginId, contributionId },
      { signal: controller.signal },
    ).then((result) => {
      if (controller.signal.aborted) return;
      dirtyFields.current.clear();
      setValues(Object.freeze({ ...initialValues, ...result.values }));
      setHydrationState('ready');
    }).catch(() => {
      if (!controller.signal.aborted) setHydrationState('error');
    });
    return () => controller.abort();
  }, [contributionId, initialValues, pluginId, service, stateKey]);

  useEffect(() => () => actionController.current?.abort(), [contributionId, pluginId]);

  const updateValue = (name: string, value: string) => {
    dirtyFields.current.add(name);
    setValues((current) => Object.freeze({ ...current, [name]: value }));
    setActionState({ state: 'idle' });
  };
  const updateSecret = (name: string, value: string | null) => {
    setSecretChanges((current) => ({ ...current, [name]: value }));
    setActionState({ state: 'idle' });
  };
  const requestAction = (action: RuntimePluginUiAction) => {
    if (
      actionState.state === 'running'
      || hydrationState === 'loading'
      || dataState.status === 'loading'
    ) return;
    if (!requiredFieldsComplete(node, values, secretChanges, dataState.configuredSecrets)) {
      setActionState({ actionId: action.id, reason: 'required', state: 'error' });
      return;
    }
    if (action.approval) {
      setActionState({ actionId: action.id, state: 'confirming' });
    } else {
      void runAction(action);
    }
  };
  const cancelAction = () => setActionState({ state: 'idle' });
  const runAction = async (action: RuntimePluginUiAction) => {
    if (actionController.current) return;
    const controller = new AbortController();
    actionController.current = controller;
    setActionState({ actionId: action.id, state: 'running' });
    const input: RuntimePluginUiActionInput = Object.freeze({
      pluginId,
      actionId: action.id,
      values: Object.freeze({ ...values }),
      ...(Object.keys(secretChanges).length ? { secretChanges: Object.freeze({ ...secretChanges }) } : {}),
      context: Object.freeze({
        contributionId: contribution.id,
        ...(cwd ? { cwd } : {}),
        surface: contribution.slot,
        ...(projectId ? { projectId } : {}),
        ...(threadId ? { threadId } : {}),
      }),
    });
    try {
      await service.runRendererUiAction(input, { signal: controller.signal });
      if (!controller.signal.aborted) setSecretChanges({});
      dirtyFields.current.clear();
      if (stateKey) {
        setHydrationState('loading');
        try {
          const result = await service.readRendererUiState(
            { pluginId, contributionId },
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          setValues(Object.freeze({ ...initialValues, ...result.values }));
          setHydrationState('ready');
        } catch {
          if (controller.signal.aborted) return;
          setHydrationState('error');
        }
      }
      if (!controller.signal.aborted) setActionState({ actionId: action.id, state: 'completed' });
    } catch {
      // Plugin errors never become markup or user-visible implementation details.
      if (!controller.signal.aborted) setActionState({ actionId: action.id, reason: 'action', state: 'error' });
    } finally {
      if (actionController.current === controller) actionController.current = null;
    }
  };

  const pendingAction = actionState.state === 'confirming'
    ? actions.get(actionState.actionId)
    : undefined;
  const disabled = hydrationState === 'loading'
    || dataState.status === 'loading'
    || actionState.state === 'running';
  const status = [
    dataState.status === 'loading' ? t('pluginUi.dataLoading') : null,
    actionStatus(actionState, hydrationState, translateFeature),
  ].filter(Boolean).join(' ');
  const failure = actionState.state === 'error' && actionState.reason === 'action'
    ? translateFeature('feature.pluginManagement.rendererUi.actionError')
    : dataState.status === 'error' || hydrationState === 'error' ? t('pluginUi.dataUnavailable') : null;
  const mode = contribution.slot === 'renderer.chat.composer.status'
    ? 'compact'
    : contribution.slot === 'renderer.plugin.page'
      ? 'page'
      : 'settings';
  return (
    <div className={`declarative-plugin-ui declarative-plugin-ui--${mode}${mode === 'settings' ? ' sd-settings-form' : ''}`}>
      {renderNode(contribution.tree, 'root', {
        actions,
        actionState,
        data: dataState.data,
        configuredSecrets: dataState.configuredSecrets,
        disabled,
        requestAction,
        settingsUi,
        translate: translateFeature,
        updateValue,
        updateSecret,
        secretChanges,
        values,
      })}
      {pendingAction?.approval ? (
        <ActionApproval
          approval={pendingAction.approval}
          onCancel={cancelAction}
          onConfirm={() => void runAction(pendingAction)}
          settingsUi={settingsUi}
          translate={translateFeature}
        />
      ) : null}
      <div aria-live="polite" className="declarative-plugin-ui__action-status">
        {status}
      </div>
      {failure ? <ToastNotice message={failure} /> : null}
    </div>
  );
}

type RenderContext = Readonly<{
  actions: ReadonlyMap<string, RuntimePluginUiAction>;
  actionState: ActionState;
  data: RuntimePluginUiData;
  configuredSecrets: readonly string[];
  secretChanges: Readonly<Record<string, string | null>>;
  disabled: boolean;
  requestAction(action: RuntimePluginUiAction): void;
  settingsUi?: SettingsViewUi;
  translate: RendererTranslate;
  updateValue(name: string, value: string): void;
  updateSecret(name: string, value: string | null): void;
  values: Readonly<Record<string, string>>;
}>;

function renderNode(node: RuntimePluginUiNode, path: string, context: RenderContext): ReactNode {
  if (node.type === 'stack') {
    return (
      <div
        className={`declarative-plugin-ui__stack declarative-plugin-ui__stack--${node.direction ?? 'column'} declarative-plugin-ui__stack--${node.gap ?? 'normal'}`}
        key={path}
      >
        {node.children.map((child, index) => renderNode(child, `${path}.${index}`, context))}
      </div>
    );
  }
  if (node.type === 'text') {
    return (
      <span className={`declarative-plugin-ui__text is-${node.tone ?? 'default'}`} key={path}>
        {resolveRuntimePluginUiText(node.text, context.data)}
      </span>
    );
  }
  if (node.type === 'badge') {
    return (
      <span className={`declarative-plugin-ui__badge is-${node.tone ?? 'default'}`} key={path}>
        {resolveRuntimePluginUiText(node.text, context.data)}
      </span>
    );
  }
  if (node.type === 'notice') {
    const title = resolveRuntimePluginUiText(node.title, context.data);
    return (
      <div className={`declarative-plugin-ui__notice is-${node.tone ?? 'default'}`} key={path} role="status">
        {title ? <strong>{title}</strong> : null}
        <span>{resolveRuntimePluginUiText(node.text, context.data)}</span>
      </div>
    );
  }
  if (node.type === 'boolean') return <label className="declarative-plugin-ui__field" key={path}>
    <span>{node.label}</span><Switch label={node.label} checked={context.values[node.name] === 'true'} disabled={context.disabled}
      onCheckedChange={(checked) => context.updateValue(node.name, String(checked))} />
  </label>;
  if (node.type === 'number') return <label className="declarative-plugin-ui__field" key={path}>
    <span>{node.label}</span><UiTextField type="number" min={node.min} max={node.max} step={node.step ?? 'any'} required={node.required}
      disabled={context.disabled} value={context.values[node.name] ?? ''}
      aria-invalid={!validPluginUiScalarValue(node, context.values[node.name] ?? '') || undefined}
      onChange={(event) => context.updateValue(node.name, event.currentTarget.value)} />
  </label>;
  if (node.type === 'field') {
    if (node.secret) return (
      <PluginSecretField
        key={path}
        field={node}
        configured={context.configuredSecrets.includes(node.name)}
        change={context.secretChanges[node.name]}
        disabled={context.disabled}
        onChange={(value) => context.updateSecret(node.name, value)}
        translate={context.translate}
      />
    );
    const inputProps = {
      disabled: context.disabled,
      maxLength: node.maxLength,
      onChange: (event: ChangeEvent<HTMLInputElement>) => (
        context.updateValue(node.name, event.currentTarget.value)
      ),
      placeholder: node.placeholder,
      required: node.required,
      type: 'text',
      value: context.values[node.name] ?? '',
    } as const;
    const input = context.settingsUi
      ? <context.settingsUi.TextField {...inputProps} />
      : <UiTextField {...inputProps} />;
    return (
      <label className="declarative-plugin-ui__field" key={path}>
        <span>{node.label}</span>
        {input}
      </label>
    );
  }
  if (node.type === 'select') {
    const value = context.values[node.name] ?? '';
    const options = node.options.map((option) => (
      <option key={option.value} value={option.value}>{option.label}</option>
    ));
    const select = context.settingsUi ? (
      <context.settingsUi.SelectField
        aria-label={node.label}
        disabled={context.disabled}
        onValueChange={(nextValue) => context.updateValue(node.name, nextValue)}
        value={value}
      >
        {options}
      </context.settingsUi.SelectField>
    ) : (
      <UiSelectField
        aria-label={node.label}
        disabled={context.disabled}
        onValueChange={(value) => context.updateValue(node.name, value)}
        value={value}
      >
        {options}
      </UiSelectField>
    );
    return (
      <label className="declarative-plugin-ui__field" key={path}>
        <span>{node.label}</span>
        {select}
      </label>
    );
  }
  const action = context.actions.get(node.actionId);
  if (!action) return null;
  const label = context.actionState.state === 'running' && context.actionState.actionId === action.id
    ? context.translate('feature.pluginManagement.rendererUi.working')
    : node.label;
  if (context.settingsUi) {
    const Button = context.settingsUi.Button;
    return (
      <Button
        disabled={context.disabled}
        key={path}
        onClick={() => context.requestAction(action)}
        type="button"
        variant={node.variant ?? 'secondary'}
      >
        {label}
      </Button>
    );
  }
  return (
    <UiButton variant={node.variant ?? 'secondary'}
      disabled={context.disabled}
      key={path}
      onClick={() => context.requestAction(action)}
      type="button"
    >
      {label}
    </UiButton>
  );
}

function ActionApproval({
  approval,
  onCancel,
  onConfirm,
  settingsUi,
  translate,
}: Readonly<{
  approval: NonNullable<RuntimePluginUiAction['approval']>;
  onCancel(): void;
  onConfirm(): void;
  settingsUi?: SettingsViewUi;
  translate: RendererTranslate;
}>) {
  const title = approval.title
    ?? translate('feature.pluginManagement.rendererUi.approvalTitle');
  const actions = settingsUi ? (
    <>
      <settingsUi.Button onClick={onCancel} type="button" variant="secondary">
        {translate('feature.pluginManagement.rendererUi.cancel')}
      </settingsUi.Button>
      <settingsUi.Button onClick={onConfirm} type="button" variant="primary">
        {translate('feature.pluginManagement.rendererUi.confirm')}
      </settingsUi.Button>
    </>
  ) : (
    <>
      <UiButton variant="secondary" onClick={onCancel} type="button">
        {translate('feature.pluginManagement.rendererUi.cancel')}
      </UiButton>
      <UiButton variant="primary" onClick={onConfirm} type="button">
        {translate('feature.pluginManagement.rendererUi.confirm')}
      </UiButton>
    </>
  );
  return (
    <div aria-label={title} className="declarative-plugin-ui__approval" role="group">
      <strong>{title}</strong>
      <span>{approval.message}</span>
      <div className="declarative-plugin-ui__approval-actions">{actions}</div>
    </div>
  );
}

function actionStatus(
  actionState: ActionState,
  hydrationState: HydrationState,
  translate: RendererTranslate,
): string {
  if (hydrationState === 'loading') return translate('feature.pluginManagement.rendererUi.loading');
  if (actionState.state === 'completed') return translate('feature.pluginManagement.rendererUi.completed');
  if (actionState.state === 'error' && actionState.reason === 'required') return translate('feature.pluginManagement.rendererUi.requiredError');
  return '';
}

function collectInitialValues(
  node: RuntimePluginUiNode,
  data: RuntimePluginUiData,
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  visitNodes(node, (candidate) => {
    if (candidate.type === 'number' || candidate.type === 'boolean') values[candidate.name] = String(candidate.defaultValue ?? (candidate.type === 'boolean' ? false : ''));
    if (candidate.type === 'field' && !candidate.secret) {
      values[candidate.name] = resolveRuntimePluginUiText(candidate.defaultValue, data)
        .slice(0, candidate.maxLength);
    }
    if (candidate.type === 'select') {
      const resolved = resolveRuntimePluginUiText(candidate.defaultValue, data);
      values[candidate.name] = candidate.options.some((option) => option.value === resolved)
        ? resolved
        : candidate.options[0]?.value ?? '';
    }
  });
  return Object.freeze(values);
}

function requiredFieldsComplete(
  node: RuntimePluginUiNode,
  values: Readonly<Record<string, string>>,
  secretChanges: Readonly<Record<string, string | null>>,
  configuredSecrets: readonly string[],
): boolean {
  let complete = true;
  visitNodes(node, (candidate) => {
    if ((candidate.type === 'number' || candidate.type === 'boolean') && !validPluginUiScalarValue(candidate, values[candidate.name] ?? '')) complete = false;
    if (candidate.type !== 'field' || !candidate.required) return;
    const change = secretChanges[candidate.name];
    const present = candidate.secret
      ? Boolean(change?.trim() || (change !== null && configuredSecrets.includes(candidate.name)))
      : Boolean(values[candidate.name]?.trim());
    if (!present) complete = false;
  });
  return complete;
}

function visitNodes(node: RuntimePluginUiNode, visit: (node: RuntimePluginUiNode) => void): void {
  visit(node);
  if (node.type === 'stack') node.children.forEach((child) => visitNodes(child, visit));
}

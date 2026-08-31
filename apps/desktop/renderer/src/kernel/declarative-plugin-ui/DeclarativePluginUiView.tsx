import type {
  RuntimePluginUiAction,
  RuntimePluginUiActionInput,
  RuntimePluginUiContribution,
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

type ActionState =
  | Readonly<{ state: 'idle' }>
  | Readonly<{ actionId: string; state: 'confirming' | 'running' | 'completed' }>
  | Readonly<{ actionId: string; reason: 'action' | 'required'; state: 'error' }>;

type HydrationState = 'loading' | 'ready' | 'error';

export function DeclarativePluginUiView({
  contribution,
  manifest,
  pluginId,
  service,
  settingsUi,
  threadId,
  translate,
}: Readonly<{
  contribution: RuntimePluginUiContribution;
  manifest: RuntimePluginUiManifest;
  pluginId: string;
  service: PluginManagementRendererService;
  settingsUi?: SettingsViewUi;
  threadId?: string;
  translate: RendererTranslate;
}>) {
  const { id: contributionId, slot, stateKey, tree: node } = contribution;
  const initialValues = useMemo(() => collectInitialValues(node), [node]);
  const [values, setValues] = useState<Readonly<Record<string, string>>>(initialValues);
  const [hydrationState, setHydrationState] = useState<HydrationState>(stateKey ? 'loading' : 'ready');
  const [actionState, setActionState] = useState<ActionState>({ state: 'idle' });
  const actionController = useRef<AbortController | null>(null);
  const actions = useMemo(() => new Map(manifest.actions.map((action) => [action.id, action])), [manifest]);

  useEffect(() => {
    const controller = new AbortController();
    setValues(initialValues);
    setActionState({ state: 'idle' });
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
      setValues(Object.freeze({ ...initialValues, ...result.values }));
      setHydrationState('ready');
    }).catch(() => {
      if (!controller.signal.aborted) setHydrationState('error');
    });
    return () => controller.abort();
  }, [contributionId, initialValues, pluginId, service, stateKey]);

  useEffect(() => () => actionController.current?.abort(), [contributionId, pluginId]);

  const updateValue = (name: string, value: string) => {
    setValues((current) => Object.freeze({ ...current, [name]: value }));
    setActionState({ state: 'idle' });
  };
  const requestAction = (action: RuntimePluginUiAction) => {
    if (actionState.state === 'running' || hydrationState === 'loading') return;
    if (!requiredFieldsComplete(node, values)) {
      setActionState({ actionId: action.id, reason: 'required', state: 'error' });
      return;
    }
    setActionState({ actionId: action.id, state: 'confirming' });
  };
  const cancelAction = () => setActionState({ state: 'idle' });
  const confirmAction = async () => {
    if (actionState.state !== 'confirming') return;
    const action = actions.get(actionState.actionId);
    if (!action) return;
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    setActionState({ actionId: action.id, state: 'running' });
    const input: RuntimePluginUiActionInput = Object.freeze({
      pluginId,
      actionId: action.id,
      values: Object.freeze({ ...values }),
      context: Object.freeze({
        contributionId,
        surface: slot,
        ...(threadId ? { threadId } : {}),
      }),
    });
    try {
      await service.runRendererUiAction(input, { signal: controller.signal });
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
  const disabled = hydrationState === 'loading' || actionState.state === 'running';
  const status = actionStatus(actionState, hydrationState, translate);

  return (
    <div className={`declarative-plugin-ui declarative-plugin-ui--${slot === 'renderer.chat.composer.status' ? 'compact' : 'settings'}`}>
      {renderNode(node, 'root', {
        actions,
        actionState,
        disabled,
        requestAction,
        settingsUi,
        translate,
        updateValue,
        values,
      })}
      {pendingAction ? (
        <ActionApproval
          action={pendingAction}
          onCancel={cancelAction}
          onConfirm={() => void confirmAction()}
          settingsUi={settingsUi}
          translate={translate}
        />
      ) : null}
      <div aria-live="polite" className="declarative-plugin-ui__action-status">
        {status}
      </div>
    </div>
  );
}

type RenderContext = Readonly<{
  actions: ReadonlyMap<string, RuntimePluginUiAction>;
  actionState: ActionState;
  disabled: boolean;
  requestAction(action: RuntimePluginUiAction): void;
  settingsUi?: SettingsViewUi;
  translate: RendererTranslate;
  updateValue(name: string, value: string): void;
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
    return <span className={`declarative-plugin-ui__text is-${node.tone ?? 'default'}`} key={path}>{node.text}</span>;
  }
  if (node.type === 'badge') {
    return <span className={`declarative-plugin-ui__badge is-${node.tone ?? 'default'}`} key={path}>{node.text}</span>;
  }
  if (node.type === 'notice') {
    return (
      <div className={`declarative-plugin-ui__notice is-${node.tone ?? 'default'}`} key={path} role="status">
        {node.title ? <strong>{node.title}</strong> : null}
        <span>{node.text}</span>
      </div>
    );
  }
  if (node.type === 'field') {
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
      : <input {...inputProps} />;
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
      <select
        disabled={context.disabled}
        onChange={(event) => context.updateValue(node.name, event.currentTarget.value)}
        value={value}
      >
        {options}
      </select>
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
    <button
      className={`declarative-plugin-ui__button is-${node.variant ?? 'secondary'}`}
      disabled={context.disabled}
      key={path}
      onClick={() => context.requestAction(action)}
      type="button"
    >
      {label}
    </button>
  );
}

function ActionApproval({
  action,
  onCancel,
  onConfirm,
  settingsUi,
  translate,
}: Readonly<{
  action: RuntimePluginUiAction;
  onCancel(): void;
  onConfirm(): void;
  settingsUi?: SettingsViewUi;
  translate: RendererTranslate;
}>) {
  const title = action.approval.title
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
      <button className="declarative-plugin-ui__button is-secondary" onClick={onCancel} type="button">
        {translate('feature.pluginManagement.rendererUi.cancel')}
      </button>
      <button className="declarative-plugin-ui__button is-primary" onClick={onConfirm} type="button">
        {translate('feature.pluginManagement.rendererUi.confirm')}
      </button>
    </>
  );
  return (
    <div aria-label={title} className="declarative-plugin-ui__approval" role="group">
      <strong>{title}</strong>
      <span>{action.approval.message}</span>
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
  if (hydrationState === 'error') return translate('feature.pluginManagement.rendererUi.stateError');
  if (actionState.state === 'completed') return translate('feature.pluginManagement.rendererUi.completed');
  if (actionState.state === 'error') {
    return translate(actionState.reason === 'required'
      ? 'feature.pluginManagement.rendererUi.requiredError'
      : 'feature.pluginManagement.rendererUi.actionError');
  }
  return '';
}

function collectInitialValues(node: RuntimePluginUiNode): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  visitNodes(node, (candidate) => {
    if (candidate.type === 'field') values[candidate.name] = candidate.defaultValue ?? '';
    if (candidate.type === 'select') values[candidate.name] = candidate.defaultValue ?? candidate.options[0]?.value ?? '';
  });
  return Object.freeze(values);
}

function requiredFieldsComplete(node: RuntimePluginUiNode, values: Readonly<Record<string, string>>): boolean {
  let complete = true;
  visitNodes(node, (candidate) => {
    if (candidate.type === 'field' && candidate.required && !values[candidate.name]?.trim()) complete = false;
  });
  return complete;
}

function visitNodes(node: RuntimePluginUiNode, visit: (node: RuntimePluginUiNode) => void): void {
  visit(node);
  if (node.type === 'stack') node.children.forEach((child) => visitNodes(child, visit));
}

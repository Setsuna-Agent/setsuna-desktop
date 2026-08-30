import type {
  RuntimePluginUiAction,
  RuntimePluginUiActionInput,
  RuntimePluginUiManifest,
  RuntimePluginUiNode,
  RuntimePluginUiSlotId,
} from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { useMemo, useState, type ReactNode } from 'react';

type ActionState = Readonly<{
  actionId?: string;
  state: 'idle' | 'running' | 'completed' | 'error';
}>;

export function DeclarativePluginUiView({
  contributionId,
  manifest,
  node,
  pluginId,
  service,
  settingsUi,
  slot,
  threadId,
}: Readonly<{
  contributionId: string;
  manifest: RuntimePluginUiManifest;
  node: RuntimePluginUiNode;
  pluginId: string;
  service: PluginManagementRendererService;
  settingsUi?: SettingsViewUi;
  slot: RuntimePluginUiSlotId;
  threadId?: string;
}>) {
  const initialValues = useMemo(() => collectInitialValues(node), [node]);
  const [values, setValues] = useState<Readonly<Record<string, string>>>(initialValues);
  const [actionState, setActionState] = useState<ActionState>({ state: 'idle' });
  const actions = useMemo(() => new Map(manifest.actions.map((action) => [action.id, action])), [manifest]);

  const updateValue = (name: string, value: string) => {
    setValues((current) => Object.freeze({ ...current, [name]: value }));
  };
  const runAction = async (action: RuntimePluginUiAction) => {
    if (actionState.state === 'running') return;
    if (!requiredFieldsComplete(node, values)) {
      setActionState({ actionId: action.id, state: 'error' });
      return;
    }
    const prompt = [action.approval.title, action.approval.message].filter(Boolean).join('\n\n');
    if (!window.confirm(prompt)) return;
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
      await service.runRendererUiAction(input);
      setActionState({ actionId: action.id, state: 'completed' });
    } catch {
      // Plugin errors never become markup or user-visible implementation details.
      setActionState({ actionId: action.id, state: 'error' });
    }
  };

  return (
    <div className={`declarative-plugin-ui declarative-plugin-ui--${slot === 'renderer.chat.composer.status' ? 'compact' : 'settings'}`}>
      {renderNode(node, 'root', {
        actions,
        actionState,
        runAction,
        settingsUi,
        updateValue,
        values,
      })}
      <div aria-live="polite" className="declarative-plugin-ui__action-status">
        {actionState.state === 'completed' ? 'Action completed.' : null}
        {actionState.state === 'error' ? 'Action failed. Check the required values and try again.' : null}
      </div>
    </div>
  );
}

type RenderContext = Readonly<{
  actions: ReadonlyMap<string, RuntimePluginUiAction>;
  actionState: ActionState;
  runAction(action: RuntimePluginUiAction): Promise<void>;
  settingsUi?: SettingsViewUi;
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
    return (
      <label className="declarative-plugin-ui__field" key={path}>
        <span>{node.label}</span>
        <input
          maxLength={node.maxLength}
          onChange={(event) => context.updateValue(node.name, event.currentTarget.value)}
          placeholder={node.placeholder}
          required={node.required}
          type="text"
          value={context.values[node.name] ?? ''}
        />
      </label>
    );
  }
  if (node.type === 'select') {
    return (
      <label className="declarative-plugin-ui__field" key={path}>
        <span>{node.label}</span>
        <select
          onChange={(event) => context.updateValue(node.name, event.currentTarget.value)}
          value={context.values[node.name] ?? ''}
        >
          {node.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  const action = context.actions.get(node.actionId);
  if (!action) return null;
  const disabled = context.actionState.state === 'running';
  const label = context.actionState.actionId === action.id && context.actionState.state === 'running'
    ? 'Working…'
    : node.label;
  if (context.settingsUi) {
    const Button = context.settingsUi.Button;
    return (
      <Button
        disabled={disabled}
        key={path}
        onClick={() => void context.runAction(action)}
        variant={node.variant ?? 'secondary'}
      >
        {label}
      </Button>
    );
  }
  return (
    <button
      className={`declarative-plugin-ui__button is-${node.variant ?? 'secondary'}`}
      disabled={disabled}
      key={path}
      onClick={() => void context.runAction(action)}
      type="button"
    >
      {label}
    </button>
  );
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

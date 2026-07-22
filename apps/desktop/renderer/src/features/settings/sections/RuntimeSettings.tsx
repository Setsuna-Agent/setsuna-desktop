import type { RuntimeConfigState, RuntimeDesktopSettings } from '@setsuna-desktop/contracts';
import { ChevronRight, Database, FileCog, FolderOpen, Plus, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  runtimeAccessModeSelection as accessModeSelection,
  runtimeAccessModeForConfig,
  runtimeAccessModeOptions,
} from '../../../shared/lib/runtimeAccessMode.js';
import { RuntimeAccessModeMenu } from '../../../shared/ui/RuntimeAccessModeMenu.js';
import { Button, IconButton, TextArea, TextField } from '../../../shared/ui/primitives.js';
import { WorkspaceDependenciesSettings } from '../WorkspaceDependenciesSettings.js';
import { MemorySettingToggle } from '../components/SettingsControls.js';
import type { RuntimePreferenceInput } from '../settings-types.js';
import { errorMessage } from '../settings-utils.js';

export function RuntimePolicySettings({
  config,
  skillExtraRoots,
  onSave,
  onSetSkillExtraRoots,
}: {
  config: RuntimeConfigState;
  skillExtraRoots: string[];
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
  onSetSkillExtraRoots: (roots: string[]) => Promise<void>;
}) {
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [localPathError, setLocalPathError] = useState<string | null>(null);

  const openRuntimePath = async (targetPath: string, label: string) => {
    const normalizedPath = targetPath.trim();
    if (!normalizedPath) {
      setLocalPathError(`${label}路径为空。`);
      return;
    }
    const api = window.setsunaDesktop?.desktop;
    if (!api?.openPath) {
      setLocalPathError('当前环境不支持打开本地路径。');
      return;
    }
    setOpeningPath(normalizedPath);
    setLocalPathError(null);
    try {
      const result = await api.openPath(normalizedPath);
      if (!result.ok) setLocalPathError(result.error || `${label}打开失败。`);
    } catch (unknownError) {
      setLocalPathError(errorMessage(unknownError, `${label}打开失败。`));
    } finally {
      setOpeningPath(null);
    }
  };

  const isOpeningConfig = openingPath === config.configPath;
  const isOpeningData = openingPath === config.dataPath;
  const pathActionDisabled = Boolean(openingPath);
  const accessMode = runtimeAccessModeForConfig(config);
  const accessModeOption = runtimeAccessModeOptions.find((option) => option.value === accessMode) ?? runtimeAccessModeOptions[1];
  const persistWorkspaceDependencySettings = (
    settings: Partial<Pick<RuntimeDesktopSettings, 'npmRegistryUrl' | 'pythonPackageIndexUrl' | 'workspaceDependenciesEnabled'>>,
  ) => onSave({
    desktopSettings: {
      ...(config.desktopSettings ?? {}),
      ...settings,
    },
  });

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__runtime-section">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">权限</div>
        <div className="chat-user-settings__group chat-user-settings__runtime-card">
          <label className="chat-user-settings__row chat-user-settings__runtime-policy-row">
            <span className="chat-user-settings__runtime-policy-copy">
              <ShieldCheck size={14} />
              <span>
                <strong>权限策略</strong>
                <small>{accessModeOption.description}</small>
              </span>
            </span>
            <RuntimeAccessModeMenu
              mode={accessMode}
              variant="settings"
              onChange={(mode) => void onSave(accessModeSelection(mode))}
            />
          </label>
        </div>
      </div>

      <WorkspaceDependenciesSettings
        npmRegistryUrl={typeof config.desktopSettings?.npmRegistryUrl === 'string' ? config.desktopSettings.npmRegistryUrl : ''}
        pythonPackageIndexUrl={typeof config.desktopSettings?.pythonPackageIndexUrl === 'string' ? config.desktopSettings.pythonPackageIndexUrl : ''}
        onEnabledPersist={(enabled) => persistWorkspaceDependencySettings({ workspaceDependenciesEnabled: enabled })}
        onNpmRegistryUrlPersist={(npmRegistryUrl) => persistWorkspaceDependencySettings({ npmRegistryUrl })}
        onPythonPackageIndexUrlPersist={(pythonPackageIndexUrl) => persistWorkspaceDependencySettings({ pythonPackageIndexUrl })}
      />

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">本地存储</div>
        <div className="chat-user-settings__group chat-user-settings__runtime-card">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <FileCog size={14} />
              <span>配置文件</span>
            </span>
            <div className="chat-user-settings__path-control">
              <code title={config.configPath}>{config.configPath}</code>
              <Button className="chat-user-settings__path-open" icon={<FolderOpen size={14} />} disabled={pathActionDisabled} onClick={() => void openRuntimePath(config.configPath, '配置文件')}>
                {isOpeningConfig ? '打开中' : '打开'}
              </Button>
            </div>
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Database size={14} />
              <span>数据目录</span>
            </span>
            <div className="chat-user-settings__path-control">
              <code title={config.dataPath}>{config.dataPath}</code>
              <Button className="chat-user-settings__path-open" icon={<FolderOpen size={14} />} disabled={pathActionDisabled} onClick={() => void openRuntimePath(config.dataPath, '数据目录')}>
                {isOpeningData ? '打开中' : '打开'}
              </Button>
            </div>
          </div>
        </div>
        {localPathError ? <div className="chat-user-settings__runtime-error">{localPathError}</div> : null}
      </div>

      <RuntimeAdvancedSettings
        config={config}
        skillExtraRoots={skillExtraRoots}
        onSave={onSave}
        onSetSkillExtraRoots={onSetSkillExtraRoots}
      />
    </div>
  );
}

function RuntimeAdvancedSettings({
  config,
  skillExtraRoots,
  onSave,
  onSetSkillExtraRoots,
}: {
  config: RuntimeConfigState;
  skillExtraRoots: string[];
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
  onSetSkillExtraRoots: (roots: string[]) => Promise<void>;
}) {
  const [featureFlagsDraft, setFeatureFlagsDraft] = useState(() => JSON.stringify(config.features ?? {}, null, 2));
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  useEffect(() => {
    setFeatureFlagsDraft(JSON.stringify(config.features ?? {}, null, 2));
  }, [config.features]);

  return (
    <details className="chat-user-settings__section-block chat-user-settings__advanced-disclosure">
      <summary className="chat-user-settings__advanced-summary">
        <span className="chat-user-settings__advanced-icon" aria-hidden="true">
          <ShieldCheck size={16} />
        </span>
        <span className="chat-user-settings__advanced-copy">
          <strong>高级安全与实验功能</strong>
          <small>沙箱目录、Hook 信任、额外 Skill 与实验开关</small>
        </span>
        <span className="chat-user-settings__advanced-toggle" aria-hidden="true">
          <ChevronRight className="chat-user-settings__advanced-chevron" size={15} />
        </span>
      </summary>
      <div className="chat-user-settings__group chat-user-settings__runtime-card chat-user-settings__runtime-advanced">
        <MemorySettingToggle
          checked={config.sandboxWorkspaceWrite?.networkAccess === true}
          description="允许 workspace-write 沙箱中的工具访问网络。"
          label="沙箱网络访问"
          onChange={(networkAccess) => void onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), networkAccess } })}
        />
        <MemorySettingToggle
          checked={config.bypassHookTrust === true}
          description="跳过本地 Hook hash 信任检查，仅应在受控环境中开启。"
          label="绕过 Hook 信任"
          onChange={(bypassHookTrust) => void onSave({ bypassHookTrust })}
        />
        <RuntimeDirectoryListField
          description="允许 workspace-write 沙箱额外读取这些目录。"
          label="额外可读目录"
          value={config.sandboxWorkspaceWrite?.readableRoots ?? []}
          onSave={(readableRoots) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), readableRoots } })}
        />
        <RuntimeDirectoryListField
          description="允许 workspace-write 沙箱额外写入这些目录。"
          label="额外可写目录"
          value={config.sandboxWorkspaceWrite?.writableRoots ?? []}
          onSave={(writableRoots) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), writableRoots } })}
        />
        <RuntimeDirectoryListField
          description="无论其他权限如何，都禁止访问这些目录。"
          label="拒绝访问目录"
          value={config.sandboxWorkspaceWrite?.deniedRoots ?? []}
          onSave={(deniedRoots) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), deniedRoots } })}
        />
        <RuntimeTextListField
          description="逐条添加需要拒绝的 Glob 表达式。"
          label="拒绝 Glob"
          value={config.sandboxWorkspaceWrite?.deniedGlobPatterns ?? []}
          onSave={(deniedGlobPatterns) => onSave({ sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}), deniedGlobPatterns } })}
        />
        <RuntimeDirectoryListField
          description="从默认位置之外加载 Skill；仅当前 runtime 会话有效。"
          label="额外 Skill 目录"
          value={skillExtraRoots}
          onSave={onSetSkillExtraRoots}
        />
        <div className="chat-user-settings__runtime-json-field">
          <span>Feature flags（JSON）</span>
          <TextArea rows={6} value={featureFlagsDraft} onChange={(event) => setFeatureFlagsDraft(event.currentTarget.value)} />
          <Button onClick={() => {
            try {
              const parsed = JSON.parse(featureFlagsDraft) as unknown;
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Feature flags 必须是 JSON 对象。');
              const flags = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
              setAdvancedError(null);
              void onSave({ features: flags });
            } catch (unknownError) {
              setAdvancedError(errorMessage(unknownError, 'Feature flags 格式无效。'));
            }
          }}>保存 Feature flags</Button>
        </div>
        <div className="chat-user-settings__runtime-memory-tuning">
          <strong>记忆整理参数</strong>
          <TextField
            defaultValue={config.memory.consolidationModel ?? ''}
            placeholder="整理模型（留空跟随当前模型）"
            onBlur={(event) => void onSave({ memory: { consolidationModel: event.currentTarget.value.trim() || undefined } })}
          />
          <TextField
            type="number"
            min="1"
            defaultValue={config.memory.maxRolloutsPerStartup ?? ''}
            placeholder="每次启动最多处理 Rollouts"
            onBlur={(event) => void onSave({ memory: { maxRolloutsPerStartup: optionalPositiveNumber(event.currentTarget.value) } })}
          />
          <TextField
            type="number"
            min="1"
            defaultValue={config.memory.maxRawMemoriesForConsolidation ?? ''}
            placeholder="整理前最大原始记忆数"
            onBlur={(event) => void onSave({ memory: { maxRawMemoriesForConsolidation: optionalPositiveNumber(event.currentTarget.value) } })}
          />
        </div>
      </div>
      {advancedError ? <div className="chat-user-settings__runtime-error">{advancedError}</div> : null}
    </details>
  );
}

function RuntimeDirectoryListField({
  description,
  label,
  value,
  onSave,
}: {
  description: string;
  label: string;
  value: string[];
  onSave: (items: string[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (items: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(items);
      return true;
    } catch (unknownError) {
      setError(errorMessage(unknownError, `${label}保存失败。`));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addDirectory = async () => {
    const api = window.setsunaDesktop?.desktop;
    if (!api?.selectDirectory) {
      setError('当前环境不支持选择目录。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const selected = await api.selectDirectory({ title: `选择${label}` });
      if (selected && !value.includes(selected)) await onSave([...value, selected]);
    } catch (unknownError) {
      setError(errorMessage(unknownError, `${label}添加失败。`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <RuntimeListEditor
      action={<Button icon={<FolderOpen size={14} />} disabled={busy} onClick={() => void addDirectory()}>{busy ? '处理中' : '添加目录'}</Button>}
      busy={busy}
      description={description}
      error={error}
      items={value}
      label={label}
      onRemove={(item) => void commit(value.filter((current) => current !== item))}
    />
  );
}

function RuntimeTextListField({
  description,
  label,
  value,
  onSave,
}: {
  description: string;
  label: string;
  value: string[];
  onSave: (items: string[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (items: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(items);
      return true;
    } catch (unknownError) {
      setError(errorMessage(unknownError, `${label}保存失败。`));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const item = draft.trim();
    if (!item || value.includes(item)) return;
    if (await commit([...value, item])) setDraft('');
  };

  return (
    <RuntimeListEditor
      action={(
        <form className="chat-user-settings__runtime-list-add" onSubmit={(event) => void addItem(event)}>
          <TextField aria-label={`添加${label}`} disabled={busy} placeholder="输入一条规则" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
          <Button icon={<Plus size={14} />} disabled={busy || !draft.trim()} type="submit">添加</Button>
        </form>
      )}
      busy={busy}
      description={description}
      error={error}
      items={value}
      label={label}
      onRemove={(item) => void commit(value.filter((current) => current !== item))}
    />
  );
}

function RuntimeListEditor({
  action,
  busy,
  description,
  error,
  items,
  label,
  onRemove,
}: {
  action: ReactNode;
  busy: boolean;
  description: string;
  error: string | null;
  items: string[];
  label: string;
  onRemove: (item: string) => void;
}) {
  return (
    <div className="chat-user-settings__runtime-list-editor">
      <div className="chat-user-settings__runtime-list-head">
        <span className="chat-user-settings__runtime-list-copy">
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
        {action}
      </div>
      {items.length ? (
        <div className="chat-user-settings__runtime-list-items">
          {items.map((item) => (
            <div className="chat-user-settings__runtime-list-item" key={item}>
              <code title={item}>{item}</code>
              <IconButton label={`移除 ${item}`} disabled={busy} onClick={() => onRemove(item)}><X size={14} /></IconButton>
            </div>
          ))}
        </div>
      ) : (
        <span className="chat-user-settings__runtime-list-empty">暂未添加</span>
      )}
      {error ? <span className="chat-user-settings__runtime-list-error" role="alert">{error}</span> : null}
    </div>
  );
}

function optionalPositiveNumber(value: string): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

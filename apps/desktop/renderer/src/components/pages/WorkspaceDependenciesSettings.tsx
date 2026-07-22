import { useEffect, useState, type FormEvent } from 'react';
import {
  CircleGauge,
  Code2,
  Download,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import {
  DEFAULT_NPM_REGISTRY_URL,
  DEFAULT_PYTHON_PACKAGE_INDEX_URL,
  normalizeNpmRegistryUrl,
  normalizePythonPackageIndexUrl,
} from '@setsuna-desktop/contracts';
import type {
  RuntimeWorkspaceDependenciesStatus,
  RuntimeWorkspaceDependencyCheck,
  RuntimeWorkspaceDependencySource,
  RuntimeWorkspaceDependencyToolStatus,
} from '@setsuna-desktop/contracts';
import { useWorkspaceDependencies } from '../../hooks/useWorkspaceDependencies.js';
import { Button, StatusBadge, TextField } from '../primitives.js';

type WorkspaceDependenciesSettingsProps = {
  npmRegistryUrl: string;
  onEnabledPersist: (enabled: boolean) => Promise<void>;
  onNpmRegistryUrlPersist: (registryUrl: string | undefined) => Promise<void>;
  onPythonPackageIndexUrlPersist: (packageIndexUrl: string | undefined) => Promise<void>;
  pythonPackageIndexUrl: string;
};

export function WorkspaceDependenciesSettings({
  npmRegistryUrl,
  onEnabledPersist,
  onNpmRegistryUrlPersist,
  onPythonPackageIndexUrlPersist,
  pythonPackageIndexUrl,
}: WorkspaceDependenciesSettingsProps) {
  const dependencies = useWorkspaceDependencies();
  const [persistError, setPersistError] = useState<string | null>(null);
  const busy = dependencies.busyAction !== null;
  const status = dependencies.status;
  const showEnvironmentDetails = Boolean(
    status?.updatedAt
    || status?.error
    || status?.state === 'ready'
    || dependencies.hasDiagnosed,
  );
  const setEnabled = async (enabled: boolean) => {
    setPersistError(null);
    const nextStatus = await dependencies.setEnabled(enabled);
    if (!nextStatus) return;
    try {
      await onEnabledPersist(nextStatus.enabled);
    } catch (unknownError) {
      setPersistError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  return (
    <div className="chat-user-settings__section-block workspace-dependencies-settings">
      <div className="chat-user-settings__group-title">工作空间依赖项</div>
      <div className="chat-user-settings__group chat-user-settings__runtime-card workspace-dependencies-settings__card">
        <div className="chat-user-settings__row chat-user-settings__runtime-policy-row workspace-dependencies-settings__toggle-row">
          <span className="chat-user-settings__runtime-policy-copy">
            <Code2 className="workspace-dependencies-settings__leading-icon" aria-hidden="true" />
            <span>
              <strong>Node.js 与 Python 工具</strong>
              <small>优先复用本机 Node.js、Python 和 uv，必要时使用应用提供的版本。</small>
            </span>
          </span>
          <div className="workspace-dependencies-settings__toggle-control">
            <span>{status ? (status.enabled ? '自动管理' : '已关闭') : '读取中'}</span>
            <label className="sd-check" title="自动管理工作空间工具链">
              <input
                aria-label="自动管理工作空间工具链"
                checked={status?.enabled === true}
                disabled={busy}
                type="checkbox"
                onChange={(event) => void setEnabled(event.currentTarget.checked)}
              />
            </label>
          </div>
        </div>

        <PackageSourceForm
          defaultValue={DEFAULT_NPM_REGISTRY_URL}
          description="用于 npm、pnpm 与 Corepack。"
          id="workspace-npm-registry"
          icon="npm"
          label="npm 包源"
          normalize={normalizeNpmRegistryUrl}
          placeholder={DEFAULT_NPM_REGISTRY_URL}
          value={npmRegistryUrl}
          onPersist={onNpmRegistryUrlPersist}
        />
        <PackageSourceForm
          defaultValue={DEFAULT_PYTHON_PACKAGE_INDEX_URL}
          description="用于 pip 与 uv。"
          id="workspace-python-package-index"
          icon="python"
          label="Python 包源"
          normalize={normalizePythonPackageIndexUrl}
          placeholder={DEFAULT_PYTHON_PACKAGE_INDEX_URL}
          value={pythonPackageIndexUrl}
          onPersist={onPythonPackageIndexUrlPersist}
        />

        <div className="chat-user-settings__row workspace-dependencies-settings__status-row">
          <span className="chat-user-settings__runtime-policy-copy">
            <CircleGauge className="workspace-dependencies-settings__leading-icon" aria-hidden="true" />
            <span>
              <strong>环境状态</strong>
              <small>{environmentStatusCopy(status)}</small>
            </span>
          </span>
          <div className="workspace-dependencies-settings__status-actions">
            <span className="workspace-dependencies-settings__state">
              <StatusBadge tone={statusTone(status)}>{statusLabel(status)}</StatusBadge>
              {status?.updatedAt ? <small>{formatDate(status.updatedAt)}</small> : null}
            </span>
            <div className="workspace-dependencies-settings__action-buttons">
              <Button
                icon={dependencies.busyAction === 'diagnose'
                  ? <RefreshCw className="is-spinning" size={14} />
                  : <RefreshCw size={14} />}
                disabled={busy}
                onClick={() => void dependencies.diagnose()}
              >
                {dependencies.busyAction === 'diagnose' ? '检查中' : '检查'}
              </Button>
              <Button
                icon={dependencies.busyAction === 'reinstall'
                  ? <RefreshCw className="is-spinning" size={14} />
                  : <Download size={14} />}
                disabled={busy || status?.enabled !== true}
                onClick={() => void dependencies.reinstall()}
              >
                {dependencies.busyAction === 'reinstall' ? '安装中' : '重新安装'}
              </Button>
            </div>
          </div>
        </div>

        {showEnvironmentDetails && status ? (
          <div className="workspace-dependencies-settings__diagnostics">
            <div className="workspace-dependencies-settings__tool-grid" aria-label="工具链状态">
              {dependencyToolItems(status).map((item) => (
                <DependencyToolCard
                  check={status.checks.find((check) => check.id === item.id)}
                  key={item.id}
                  label={item.label}
                  tool={item.tool}
                />
              ))}
            </div>
          </div>
        ) : null}

        {dependencies.error || persistError ? (
          <div className="chat-user-settings__runtime-error" role="alert">{dependencies.error ?? persistError}</div>
        ) : null}
      </div>
    </div>
  );
}

type PackageSourceKind = 'npm' | 'python';

type PackageSourceFormProps = {
  defaultValue: string;
  description: string;
  id: string;
  icon: PackageSourceKind;
  label: string;
  normalize: (value: unknown) => string | null;
  onPersist: (value: string | undefined) => Promise<void>;
  placeholder: string;
  value: string;
};

function PackageSourceForm({
  defaultValue,
  description,
  id,
  icon,
  label,
  normalize,
  onPersist,
  placeholder,
  value,
}: PackageSourceFormProps) {
  const effectiveValue = value || defaultValue;
  const [draft, setDraft] = useState(effectiveValue);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const dirty = draft.trim() !== effectiveValue;
  const customized = Boolean(value && value !== defaultValue);

  useEffect(() => {
    setDraft(effectiveValue);
    setError(null);
  }, [effectiveValue]);

  const save = async (nextValue: string) => {
    const normalized = normalize(nextValue);
    if (normalized === null) {
      setError('请输入有效的 HTTP 或 HTTPS 包源地址。');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onPersist(normalized && normalized !== defaultValue ? normalized : undefined);
      setDraft(normalized || defaultValue);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(draft);
  };

  return (
    <form className="chat-user-settings__row workspace-dependencies-settings__source-row" noValidate onSubmit={submit}>
      <label className="chat-user-settings__runtime-policy-copy" htmlFor={id}>
        <PackageSourceIcon kind={icon} />
        <span>
          <strong>{label}</strong>
          <small id={helpId}>{description}</small>
        </span>
      </label>
      <div className="workspace-dependencies-settings__source-controls">
        <TextField
          id={id}
          aria-describedby={error ? `${helpId} ${errorId}` : helpId}
          aria-invalid={error ? 'true' : undefined}
          disabled={saving}
          inputMode="url"
          placeholder={placeholder}
          spellCheck={false}
          value={draft}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setError(null);
          }}
        />
        <Button className="workspace-dependencies-settings__source-save" variant={dirty ? 'primary' : 'secondary'} disabled={saving || !dirty} type="submit">
          {saving ? '保存中' : dirty ? '保存' : '已保存'}
        </Button>
        {customized ? (
          <Button
            className="workspace-dependencies-settings__source-reset"
            icon={<RotateCcw size={13} />}
            variant="ghost"
            disabled={saving}
            onClick={() => void save(defaultValue)}
          >
            默认
          </Button>
        ) : null}
      </div>
      {error ? <small className="workspace-dependencies-settings__source-error" id={errorId} role="alert">{error}</small> : null}
    </form>
  );
}

function PackageSourceIcon({ kind }: { kind: PackageSourceKind }) {
  if (kind === 'npm') {
    return (
      <svg
        className="workspace-dependencies-settings__leading-icon workspace-dependencies-settings__source-icon"
        viewBox="3 10 26 12"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M4 11.3v8h6.8v1.4h5.3v-1.3H28v-8.1H4Zm6.6 6.7H9.3v-3.9H8V18H5.3v-5.3h5.3V18Zm6.6 0h-2.7v1.4h-2.7v-6.6h5.3c.1 1.6.1 3.4.1 5.2Zm9.4 0h-1.3v-3.9H24V18h-1.4v-3.9h-1.3V18h-2.7v-5.3h8V18Zm-10.7-3.9h-1.3v2.6h1.3v-2.6Z" />
      </svg>
    );
  }

  return (
    <svg
      className="workspace-dependencies-settings__leading-icon workspace-dependencies-settings__source-icon"
      viewBox="6 6 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M15.6 15.5h-2c-1.4 0-2.3.9-2.3 2.3v1.8c0 .2-.1.3-.3.3h-.9c-.9 0-1.6-.4-2-1.2-.3-.6-.5-1.2-.5-1.8-.1-1.1-.1-2.2.3-3.3.3-.9.9-1.6 1.9-1.8h5.8c.1 0 .3 0 .3-.1v-.5s-.2-.1-.3-.1h-3.4c-.3 0-.4-.1-.4-.4V9.4c0-.7.3-1.2.9-1.4.5-.2 1-.4 1.5-.5 1.2-.2 2.4-.2 3.6.1.5.1 1 .3 1.4.6.4.4.7.8.6 1.4v3.6c0 1.4-.8 2.2-2.2 2.2-.7.1-1.4.1-2 .1Zm-2.8-6c0 .4.3.8.8.8.4 0 .8-.4.8-.8s-.4-.7-.8-.8c-.5 0-.8.4-.8.8Zm3.6 7h2c1.4 0 2.3-.9 2.3-2.3v-1.8c0-.2.1-.3.3-.3h.9c.9 0 1.6.4 2 1.2.3.6.5 1.2.5 1.8.1 1.1.1 2.2-.3 3.3-.3.9-.9 1.6-1.9 1.8h-5.8c-.1 0-.3 0-.3.1v.5s.2.1.3.1h3.4c.3 0 .4.1.4.4v1.3c0 .7-.3 1.2-.9 1.4-.5.2-1 .4-1.5.5-1.2.2-2.4.2-3.6-.1-.5-.1-1-.3-1.4-.6-.4-.4-.7-.8-.6-1.4v-3.6c0-1.4.8-2.2 2.2-2.2.7-.1 1.4-.1 2-.1Zm2.8 6c0-.4-.3-.8-.8-.8-.4 0-.8.4-.8.8s.4.7.8.8c.5 0 .8-.4.8-.8Z" />
    </svg>
  );
}

type DependencyToolItem = {
  id: Exclude<RuntimeWorkspaceDependencyCheck['id'], 'sandbox'>;
  label: string;
  tool: RuntimeWorkspaceDependencyToolStatus;
};

function dependencyToolItems(status: RuntimeWorkspaceDependenciesStatus): DependencyToolItem[] {
  return [
    { id: 'node', label: 'Node.js', tool: status.node },
    { id: 'python', label: 'Python', tool: status.python },
    { id: 'uv', label: 'uv', tool: status.uv },
  ];
}

function DependencyToolCard({
  check,
  label,
  tool,
}: {
  check?: RuntimeWorkspaceDependencyCheck;
  label: string;
  tool: RuntimeWorkspaceDependencyToolStatus;
}) {
  const state = check?.status ?? (tool.available ? 'ok' : 'error');
  return (
    <div className="workspace-dependencies-settings__tool-item" data-status={state}>
      <div className="workspace-dependencies-settings__tool-heading">
        <span aria-hidden="true" />
        <strong>{label}</strong>
        <span className="workspace-dependencies-settings__tool-source">{dependencySourceLabel(tool.source)}</span>
      </div>
      <span className="workspace-dependencies-settings__tool-version">
        {tool.version ?? (tool.available ? '版本未知' : '尚未安装')}
      </span>
      <code title={tool.path}>{tool.path ?? '未找到可执行文件'}</code>
    </div>
  );
}

function environmentStatusCopy(status: RuntimeWorkspaceDependenciesStatus | null): string {
  if (!status) return '正在读取工具链状态。';
  if (status.state === 'ready') return 'Node.js、Python 与 uv 均已就绪。';
  if (status.state === 'installing') return '正在准备隔离工具链，请稍候。';
  if (status.state === 'error') return status.error || '工具链需要处理。';
  if (status.state === 'not-installed') return '部分工具尚未就绪，可尝试重新安装。';
  return '启用后自动复用并补齐工作区工具。';
}

function dependencySourceLabel(source: RuntimeWorkspaceDependencySource | undefined): string {
  if (source === 'system') return '本机';
  if (source === 'bundled') return '应用内置';
  if (source === 'managed') return '应用托管';
  return '未就绪';
}

function statusTone(status: RuntimeWorkspaceDependenciesStatus | null): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status?.state === 'ready') return 'success';
  if (status?.state === 'error') return 'danger';
  if (status?.state === 'not-installed') return 'warning';
  return 'neutral';
}

function statusLabel(status: RuntimeWorkspaceDependenciesStatus | null): string {
  if (!status) return '加载中';
  if (status.state === 'ready') return '可用';
  if (status.state === 'installing') return '安装中';
  if (status.state === 'error') return '异常';
  if (status.state === 'not-installed') return '待安装';
  return '未启用';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

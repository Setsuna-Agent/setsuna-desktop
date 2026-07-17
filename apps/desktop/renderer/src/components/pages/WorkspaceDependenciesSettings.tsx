import { useState } from 'react';
import { Activity, Download, RefreshCw } from 'lucide-react';
import type {
  RuntimeWorkspaceDependenciesStatus,
  RuntimeWorkspaceDependencyCheck,
} from '@setsuna-desktop/contracts';
import { useWorkspaceDependencies } from '../../hooks/useWorkspaceDependencies.js';
import { Button, StatusBadge } from '../primitives.js';

export function WorkspaceDependenciesSettings({
  onEnabledPersist,
}: {
  onEnabledPersist: (enabled: boolean) => Promise<void>;
}) {
  const dependencies = useWorkspaceDependencies();
  const [persistError, setPersistError] = useState<string | null>(null);
  const busy = dependencies.busyAction !== null;
  const status = dependencies.status;
  const showChecks = Boolean(
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
        <div className="workspace-dependencies-settings__primary">
          <span className="workspace-dependencies-settings__copy">
            <strong>Node.js 与 Python 工具</strong>
            <small>Node 直接使用应用运行时；Python 和 uv 优先复用健康的本机安装，缺失时提供隔离的托管版本。</small>
          </span>
          <label className="sd-check" title="工作空间依赖项">
            <input
              aria-label="工作空间依赖项"
              checked={status?.enabled === true}
              disabled={busy}
              type="checkbox"
              onChange={(event) => void setEnabled(event.currentTarget.checked)}
            />
          </label>
        </div>

        <div className="workspace-dependencies-settings__actions">
          <span className="workspace-dependencies-settings__state">
            <StatusBadge tone={statusTone(status)}>{statusLabel(status)}</StatusBadge>
            {status?.updatedAt ? <small>更新于 {formatDate(status.updatedAt)}</small> : null}
          </span>
          <Button
            icon={<Activity size={14} />}
            disabled={busy}
            onClick={() => void dependencies.diagnose()}
          >
            {dependencies.busyAction === 'diagnose' ? '诊断中' : '诊断'}
          </Button>
          <Button
            icon={dependencies.busyAction === 'reinstall' ? <RefreshCw className="is-spinning" size={14} /> : <Download size={14} />}
            variant="danger"
            disabled={busy || status?.enabled !== true}
            onClick={() => void dependencies.reinstall()}
          >
            {dependencies.busyAction === 'reinstall' ? '安装中' : '重新安装'}
          </Button>
        </div>

        {showChecks && status?.checks.length ? (
          <div className="workspace-dependencies-settings__checks" aria-label="依赖项诊断结果">
            {status.checks.map((check) => (
              <div className="workspace-dependencies-settings__check" key={check.id}>
                <StatusBadge tone={checkTone(check.status)}>{check.label}</StatusBadge>
                <span title={check.message}>{check.message}</span>
              </div>
            ))}
          </div>
        ) : null}
        {status?.installPath ? <code className="workspace-dependencies-settings__path" title={status.installPath}>{status.installPath}</code> : null}
        {dependencies.error || persistError ? (
          <div className="chat-user-settings__runtime-error" role="alert">{dependencies.error ?? persistError}</div>
        ) : null}
      </div>
    </div>
  );
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

function checkTone(status: RuntimeWorkspaceDependencyCheck['status']): 'success' | 'warning' | 'danger' {
  if (status === 'ok') return 'success';
  return status === 'warning' ? 'warning' : 'danger';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

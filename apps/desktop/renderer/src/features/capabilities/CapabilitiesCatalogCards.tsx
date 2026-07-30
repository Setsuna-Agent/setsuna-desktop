import type {
  RuntimeHookMetadata,
  RuntimeMcpRequireApproval,
  RuntimeMcpServer,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import {
  BookOpen,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Plug,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import {
  Button,
  IconButton,
  SelectField,
} from '../../shared/ui/primitives.js';
import {
  mcpAuthStatusLabel,
  mcpToolStats,
} from './mcp/mcp-editor-model.js';

export function CapabilitiesMcpCard({
  authPending,
  server,
  onDelete,
  onEdit,
  onLogin,
  onLogout,
  onUpdate,
}: {
  authPending: boolean;
  server: RuntimeMcpServer;
  onDelete: () => void;
  onEdit: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onUpdate: (
    patch: Partial<
      Pick<RuntimeMcpServer, 'enabled' | 'required' | 'requireApproval'>
    >,
  ) => void;
}) {
  const { t } = useI18n();
  const endpoint = server.transport === 'stdio'
    ? [server.command, ...server.args].filter(Boolean).join(' ')
    : server.url;
  const toolStats = mcpToolStats(
    server.tools,
    server.allowedTools,
    server.disabledTools,
  );
  const pending = authPending || server.authStatus === 'oAuthLoggingIn';
  const canUseOAuth = server.transport === 'streamableHttp'
    && server.authStatus !== 'bearerToken'
    && Boolean(
      server.oauthClientId
      || server.oauthResource
      || server.authStatus === 'oAuth'
      || server.authStatus === 'oAuthExpired'
      || server.authStatus === 'oAuthError',
    );

  return (
    <article className="desktop-capability-card desktop-capability-card--mcp">
      <div className="desktop-capability-card__head desktop-capability-card__head--mcp">
        <div className="desktop-capability-card__head-main desktop-capability-card__mcp-identity">
          <span className="desktop-capability-card__icon"><Plug size={20} /></span>
          <div className="desktop-capability-card__mcp-heading">
            <h2>{server.label}</h2>
            <p title={endpoint || undefined}>
              {endpoint || server.description || t('capabilities.mcp.noEndpoint')}
            </p>
          </div>
        </div>
        <span className="desktop-capability-card__head-actions">
          <IconButton label="Edit MCP server" variant="ghost" onClick={onEdit}>
            <Pencil size={14} />
          </IconButton>
          <IconButton
            label="Delete MCP server"
            variant="danger"
            disabled={server.readOnly}
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </IconButton>
        </span>
      </div>
      <div className="desktop-capability-card__mcp-summary">
        <div className="desktop-capability-card__meta">
          <span>{server.key}</span>
          <span>{server.transport}</span>
        </div>
        <div className="desktop-capability-card__tool-policy">
          <span>
            {toolStats.total
              ? t('capabilities.mcp.toolsEnabled', {
                enabled: toolStats.enabled,
                total: toolStats.total,
              })
              : t('capabilities.mcp.toolsNotFetched')}
          </span>
          <span title={server.authError}>
            {mcpAuthStatusLabel(server.authStatus, t)}
          </span>
        </div>
      </div>
      <div className="desktop-capability-card__actions desktop-capability-card__actions--mcp">
        <div className="desktop-capability-card__mcp-setting">
          <span className="desktop-capability-card__mcp-setting-label">
            {t('capabilities.mcp.serviceStatus')}
          </span>
          <div className="desktop-capability-card__mcp-switches">
            <label className="sd-check" title={t('capabilities.mcp.enableHint')}>
              <input
                type="checkbox"
                checked={server.enabled}
                disabled={server.readOnly}
                onChange={(event) => onUpdate({
                  enabled: event.currentTarget.checked,
                })}
              />
              <span>{t('capabilities.mcp.enabled')}</span>
            </label>
            <label className="sd-check" title={t('capabilities.mcp.requiredHint')}>
              <input
                type="checkbox"
                checked={server.required}
                disabled={server.readOnly}
                onChange={(event) => onUpdate({
                  required: event.currentTarget.checked,
                })}
              />
              <span>{t('capabilities.mcp.required')}</span>
            </label>
          </div>
        </div>
        <div className="desktop-capability-card__mcp-setting desktop-capability-card__mcp-approval">
          <span className="desktop-capability-card__mcp-setting-label">
            {t('capabilities.mcp.callApproval')}
          </span>
          <SelectField
            aria-label={t('capabilities.mcp.callApproval')}
            value={server.requireApproval}
            disabled={server.readOnly}
            onValueChange={(value) => onUpdate({
              requireApproval: value as RuntimeMcpRequireApproval,
            })}
          >
            <option value="auto">{t('capabilities.mcp.approval.auto')}</option>
            <option value="prompt">{t('capabilities.mcp.approval.prompt')}</option>
            <option value="approve">{t('capabilities.mcp.approval.approve')}</option>
          </SelectField>
        </div>
        {canUseOAuth ? (
          <div className="desktop-capability-card__mcp-setting">
            <span className="desktop-capability-card__mcp-setting-label">
              OAuth
            </span>
            {server.authStatus === 'oAuth' ? (
              <Button
                type="button"
                variant="secondary"
                icon={<LogOut size={14} />}
                disabled={pending}
                onClick={onLogout}
              >
                {pending ? t('common.processing') : t('capabilities.mcp.logout')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                icon={pending
                  ? <Loader2 className="is-spinning" size={14} />
                  : <LogIn size={14} />}
                disabled={pending}
                onClick={onLogin}
              >
                {t(
                  pending
                    ? 'capabilities.mcp.awaitingAuthorization'
                    : 'capabilities.mcp.login',
                )}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function CapabilitiesSkillCard({
  dependencyPending,
  skill,
  onAuthenticateDependency,
  onEdit,
  onInstallDependencies,
  onOpen,
  onUpdate,
}: {
  dependencyPending: boolean;
  skill: RuntimeSkillSummary;
  onAuthenticateDependency: (serverKey: string) => void;
  onEdit: () => void;
  onInstallDependencies: () => void;
  onOpen: () => void;
  onUpdate: (patch: Partial<Pick<RuntimeSkillSummary, 'enabled' | 'selected'>>) => void;
}) {
  const { t } = useI18n();
  const selectedByDefault = skill.enabled && skill.selected;
  const dependencies = skill.mcpDependencies ?? [];
  const installableDependencies = dependencies.filter(
    (dependency) => dependency.status === 'missing'
      || dependency.status === 'disabled'
      || dependency.status === 'unchecked',
  );
  const authDependency = dependencies.find(
    (dependency) => dependency.status === 'authRequired'
      || dependency.status === 'error',
  );

  return (
    <article className="desktop-capability-card">
      <div className="desktop-capability-card__head">
        <span className="desktop-capability-card__icon"><BookOpen size={14} /></span>
        <span className={`desktop-capability-card__status ${selectedByDefault ? 'is-on' : ''}`}>
          {t(
            selectedByDefault
              ? 'capabilities.skill.list.default'
              : skill.enabled
                ? 'capabilities.skill.list.enabled'
                : 'capabilities.skill.list.disabled',
          )}
        </span>
      </div>
      <h2>{skill.name}</h2>
      <p>{skill.description || skill.id}</p>
      <div className="desktop-capability-card__meta">
        <span>{skill.id}</span>
        {dependencies.length ? (
          <span>
            {t('capabilities.skill.list.mcpReady', {
              ready: dependencies.filter(
                (dependency) => dependency.status === 'ready',
              ).length,
              total: dependencies.length,
            })}
          </span>
        ) : null}
        {skill.dependencyErrors?.length
          ? <span>{t('capabilities.skill.list.dependencyError')}</span>
          : null}
      </div>
      <div className="desktop-capability-card__actions">
        <Button
          type="button"
          variant="ghost"
          icon={<BookOpen size={14} />}
          onClick={onOpen}
        >
          {t('capabilities.skill.list.view')}
        </Button>
        {skill.kind === 'user' ? (
          <IconButton label="Edit Skill" variant="ghost" onClick={onEdit}>
            <Pencil size={14} />
          </IconButton>
        ) : null}
        {installableDependencies.length ? (
          <Button
            type="button"
            variant="secondary"
            icon={dependencyPending
              ? <Loader2 className="is-spinning" size={14} />
              : <Plug size={14} />}
            disabled={dependencyPending}
            onClick={onInstallDependencies}
          >
            {dependencyPending
              ? t('common.processing')
              : t('capabilities.skill.list.installDependencies')}
          </Button>
        ) : authDependency ? (
          <Button
            type="button"
            variant="secondary"
            icon={dependencyPending
              ? <Loader2 className="is-spinning" size={14} />
              : <LogIn size={14} />}
            disabled={dependencyPending}
            onClick={() => onAuthenticateDependency(authDependency.value)}
          >
            {dependencyPending
              ? t('capabilities.skill.awaitingAuthorization')
              : t('capabilities.skill.list.loginDependency', {
                name: authDependency.value,
              })}
          </Button>
        ) : null}
        <label className="sd-check" title={t('capabilities.skill.enableHint')}>
          <input
            type="checkbox"
            checked={skill.enabled}
            onChange={(event) => onUpdate({
              enabled: event.currentTarget.checked,
              ...(event.currentTarget.checked ? {} : { selected: false }),
            })}
          />
          <span>{t('capabilities.skill.enabled')}</span>
        </label>
        <label className="sd-check" title={t('capabilities.skill.defaultHint')}>
          <input
            type="checkbox"
            checked={selectedByDefault}
            disabled={!skill.enabled}
            onChange={(event) => onUpdate({
              selected: event.currentTarget.checked,
            })}
          />
          <span>{t('capabilities.skill.editor.default')}</span>
        </label>
      </div>
    </article>
  );
}

export function CapabilitiesHookCard({
  hook,
  updating,
  onDelete,
  onEdit,
  onSetEnabled,
  onTrust,
}: {
  hook: RuntimeHookMetadata;
  updating: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onTrust: () => void;
}) {
  const { t } = useI18n();
  const canRun = hook.enabled
    && (hook.trustStatus === 'trusted' || hook.trustStatus === 'managed');
  const editable = !hook.isManaged && hook.source !== 'plugin';

  return (
    <article className="desktop-capability-card desktop-capability-card--hook">
      <div className="desktop-capability-card__head">
        <span className="desktop-capability-card__head-main">
          <span className="desktop-capability-card__icon">
            {canRun ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
          </span>
          <span className={`desktop-capability-card__status ${canRun ? 'is-on' : ''}`}>
            {canRun
              ? t('capabilities.hook.executable')
              : hook.enabled
                ? trustStatusLabel(hook.trustStatus, t)
                : t('capabilities.hook.disabled')}
          </span>
        </span>
        <span className="desktop-capability-card__head-actions">
          <IconButton
            label="Edit Hook"
            variant="ghost"
            disabled={updating || !editable}
            onClick={onEdit}
          >
            <Pencil size={14} />
          </IconButton>
          <IconButton
            label="Delete Hook"
            variant="danger"
            disabled={updating || !editable}
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </IconButton>
        </span>
      </div>
      <h2>{hook.eventName}</h2>
      <p
        className="desktop-capability-card__command"
        title={hook.command ?? undefined}
      >
        {hook.command || t('capabilities.hook.noCommand')}
      </p>
      <div className="desktop-capability-card__meta">
        <span>
          {hook.matcher
            ? `matcher: ${hook.matcher}`
            : t('capabilities.hook.allMatches')}
        </span>
        <span>{hook.source}</span>
        <span>{hook.timeoutSec}s</span>
      </div>
      <div className="desktop-capability-card__actions">
        <Button
          type="button"
          variant="ghost"
          icon={<ShieldCheck size={14} />}
          disabled={
            updating
            || hook.trustStatus === 'trusted'
            || hook.trustStatus === 'managed'
          }
          onClick={onTrust}
        >
          {t('capabilities.hook.trust')}
        </Button>
        <label className="sd-check" title={t('capabilities.hook.disableHint')}>
          <input
            type="checkbox"
            checked={hook.enabled}
            disabled={updating}
            onChange={(event) => onSetEnabled(event.currentTarget.checked)}
          />
          <span>{t('capabilities.hook.enabled')}</span>
        </label>
      </div>
    </article>
  );
}

function trustStatusLabel(
  status: RuntimeHookMetadata['trustStatus'],
  t: Translate,
): string {
  switch (status) {
    case 'managed':
      return t('capabilities.hook.managed');
    case 'trusted':
      return t('capabilities.hook.trusted');
    case 'modified':
      return t('capabilities.hook.modified');
    case 'untrusted':
    default:
      return t('capabilities.hook.untrusted');
  }
}

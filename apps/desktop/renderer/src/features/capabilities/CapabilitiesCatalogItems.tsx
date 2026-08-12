import type {
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
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import {
  Button,
  IconButton,
  SelectField,
} from '../../shared/ui/primitives.js';
import { SkillIcon } from '../../shared/ui/SkillIcon.js';
import {
  mcpAuthStatusLabel,
  mcpToolStats,
} from './mcp/mcp-editor-model.js';

export function CapabilitiesMcpListItem({
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
  const toolSummary = toolStats.total
    ? t('capabilities.mcp.toolsEnabled', {
      enabled: toolStats.enabled,
      total: toolStats.total,
    })
    : t('capabilities.mcp.toolsNotFetched');
  const meta = [
    server.key,
    server.transport,
    toolSummary,
    mcpAuthStatusLabel(server.authStatus, t),
  ].join(' · ');

  return (
    <article className="desktop-capability-list-item desktop-capability-list-item--mcp">
      <CapabilityListIdentity
        description={endpoint || server.description || t('capabilities.mcp.noEndpoint')}
        icon={<CapabilityListIcon kind="mcp"><Plug size={18} /></CapabilityListIcon>}
        meta={meta}
        title={server.label}
        onOpen={onEdit}
      />
      <div className="desktop-capability-list-item__aside">
        <div className="desktop-capability-list-item__actions">
          {canUseOAuth ? (
            server.authStatus === 'oAuth' ? (
              <Button
                className="desktop-capability-list-item__text-action"
                type="button"
                variant="ghost"
                icon={<LogOut size={13} />}
                disabled={pending}
                onClick={onLogout}
              >
                {pending ? t('common.processing') : t('capabilities.mcp.logout')}
              </Button>
            ) : (
              <Button
                className="desktop-capability-list-item__text-action"
                type="button"
                variant="ghost"
                icon={pending
                  ? <Loader2 className="is-spinning" size={13} />
                  : <LogIn size={13} />}
                disabled={pending}
                onClick={onLogin}
              >
                {t(
                  pending
                    ? 'capabilities.mcp.awaitingAuthorization'
                    : 'capabilities.mcp.login',
                )}
              </Button>
            )
          ) : null}
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
        </div>
        <div className="desktop-capability-list-item__settings">
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
          <div className="desktop-capability-list-item__approval">
            <span>{t('capabilities.mcp.callApproval')}</span>
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
        </div>
      </div>
    </article>
  );
}

export function CapabilitiesSkillListItem({
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
  const status = t(
    selectedByDefault
      ? 'capabilities.skill.list.default'
      : skill.enabled
        ? 'capabilities.skill.list.enabled'
        : 'capabilities.skill.list.disabled',
  );
  const meta = [
    skill.id,
    status,
    dependencies.length
      ? t('capabilities.skill.list.mcpReady', {
        ready: dependencies.filter(
          (dependency) => dependency.status === 'ready',
        ).length,
        total: dependencies.length,
      })
      : null,
    skill.dependencyErrors?.length
      ? t('capabilities.skill.list.dependencyError')
      : null,
  ].filter(Boolean).join(' · ');

  return (
    <article className="desktop-capability-list-item desktop-capability-list-item--skill">
      <CapabilityListIdentity
        description={skill.description || skill.id}
        icon={<SkillIcon skill={skill} variant="list" />}
        meta={meta}
        title={skill.name}
        onOpen={onOpen}
      />
      <div className="desktop-capability-list-item__aside">
        <div className="desktop-capability-list-item__actions">
          {installableDependencies.length ? (
            <Button
              className="desktop-capability-list-item__text-action desktop-capability-list-item__dependency-action"
              type="button"
              variant="ghost"
              icon={dependencyPending
                ? <Loader2 className="is-spinning" size={13} />
                : <Plug size={13} />}
              disabled={dependencyPending}
              onClick={onInstallDependencies}
            >
              {dependencyPending
                ? t('common.processing')
                : t('capabilities.skill.list.installDependencies')}
            </Button>
          ) : authDependency ? (
            <Button
              className="desktop-capability-list-item__text-action desktop-capability-list-item__dependency-action"
              type="button"
              variant="ghost"
              icon={dependencyPending
                ? <Loader2 className="is-spinning" size={13} />
                : <LogIn size={13} />}
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
          <IconButton label={t('capabilities.skill.list.view')} variant="ghost" onClick={onOpen}>
            <BookOpen size={14} />
          </IconButton>
          {skill.kind === 'user' ? (
            <IconButton label="Edit Skill" variant="ghost" onClick={onEdit}>
              <Pencil size={14} />
            </IconButton>
          ) : null}
        </div>
        <div className="desktop-capability-list-item__settings">
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
      </div>
    </article>
  );
}

function CapabilityListIdentity({
  description,
  icon,
  meta,
  title,
  onOpen,
}: {
  description: string;
  icon: ReactNode;
  meta: string;
  title: string;
  onOpen?: () => void;
}) {
  const content = (
    <>
      {icon}
      <span className="desktop-capability-list-item__copy">
        <strong>{title}</strong>
        <span title={description}>{description}</span>
        <small title={meta}>{meta}</small>
      </span>
    </>
  );
  return onOpen ? (
    <button
      aria-label={title}
      className="desktop-capability-list-item__identity"
      type="button"
      onClick={onOpen}
    >
      {content}
    </button>
  ) : (
    <div className="desktop-capability-list-item__identity">{content}</div>
  );
}

function CapabilityListIcon({
  children,
  kind,
}: {
  children: ReactNode;
  kind: 'mcp';
}) {
  return (
    <span className="desktop-capability-list-item__icon" data-kind={kind} aria-hidden="true">
      {children}
    </span>
  );
}

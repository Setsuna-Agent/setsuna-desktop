import type { RuntimeMcpServer, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Plug } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SkillIcon } from '../../shared/ui/SkillIcon.js';
import {
  mcpAuthStatusLabel,
  mcpToolStats,
} from './mcp/mcp-editor-model.js';

export function CapabilitiesMcpListItem({
  server,
  onOpen,
  onUpdate,
}: {
  server: RuntimeMcpServer;
  onOpen: () => void;
  onUpdate: (patch: Pick<RuntimeMcpServer, 'enabled'>) => void;
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
        onOpen={onOpen}
      />
      <div className="desktop-capability-list-item__aside">
        <div className="desktop-capability-list-item__settings">
          <label className="sd-check" title={t('capabilities.mcp.enableHint')}>
            <input
              type="checkbox"
              aria-label={t('capabilities.mcp.enabled')}
              checked={server.enabled}
              disabled={server.readOnly}
              onChange={(event) => onUpdate({
                enabled: event.currentTarget.checked,
              })}
            />
          </label>
        </div>
      </div>
    </article>
  );
}

export function CapabilitiesSkillListItem({
  skill,
  onOpen,
  onUpdate,
}: {
  skill: RuntimeSkillSummary;
  onOpen: () => void;
  onUpdate: (patch: Pick<RuntimeSkillSummary, 'enabled'>) => void;
}) {
  const { t } = useI18n();
  const dependencies = skill.mcpDependencies ?? [];
  const status = t(skill.enabled
    ? 'capabilities.skill.list.enabled'
    : 'capabilities.skill.list.disabled');
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
        <div className="desktop-capability-list-item__settings">
          <label className="sd-check" title={t('capabilities.skill.enableHint')}>
            <input
              type="checkbox"
              aria-label={t('capabilities.skill.enabled')}
              checked={skill.enabled}
              onChange={(event) => onUpdate({
                enabled: event.currentTarget.checked,
              })}
            />
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

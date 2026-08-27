import type { RuntimeMcpServer, RuntimeSkillSummary } from '@setsuna-desktop/contracts';
import { Plug } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SkillIcon } from '../../shared/ui/SkillIcon.js';

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

  return (
    <article className="desktop-capability-list-item desktop-capability-list-item--mcp">
      <CapabilityListIdentity
        description={server.description || endpoint || t('capabilities.mcp.noEndpoint')}
        icon={<CapabilityListIcon kind="mcp"><Plug size={18} /></CapabilityListIcon>}
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

  return (
    <article className="desktop-capability-list-item desktop-capability-list-item--skill">
      <CapabilityListIdentity
        description={skill.description || skill.id}
        icon={<SkillIcon skill={skill} variant="list" />}
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
  title,
  onOpen,
}: {
  description: string;
  icon: ReactNode;
  title: string;
  onOpen?: () => void;
}) {
  const content = (
    <>
      {icon}
      <span className="desktop-capability-list-item__copy">
        <strong>{title}</strong>
        <span title={description}>{description}</span>
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

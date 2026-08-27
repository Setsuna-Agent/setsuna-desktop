import type { RuntimeMcpServer } from '@setsuna-desktop/contracts';
import { Dropdown, type MenuProps } from 'antd';
import { Clock3, Loader2, LogIn, LogOut, MoreHorizontal, Plug, Settings2, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { EditIcon } from '../../../shared/ui/EditIcon.js';
import { Button, IconButton, PageHeader } from '../../../shared/ui/primitives.js';
import { CapabilitiesTopbarBreadcrumb } from '../CapabilitiesTopbarBreadcrumb.js';
import { mcpToolStats } from './mcp-editor-model.js';

export function CapabilitiesMcpDetail({
  authPending,
  server,
  onBack,
  onDelete,
  onEdit,
  onLogin,
  onLogout,
  onUpdate,
}: {
  authPending: boolean;
  server: RuntimeMcpServer;
  onBack: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onUpdate: (patch: Pick<RuntimeMcpServer, 'enabled'>) => void;
}) {
  const { t } = useI18n();
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
  const endpoint = server.transport === 'stdio'
    ? [server.command, ...server.args].filter(Boolean).join(' ')
    : server.url;
  const toolStats = mcpToolStats(server.tools, server.allowedTools, server.disabledTools);
  const disabledTools = new Set(server.disabledTools);
  const allowedTools = new Set(server.allowedTools);
  const actionItems: MenuProps['items'] = [
    {
      key: 'edit',
      disabled: server.readOnly,
      icon: <EditIcon size={14} />,
      label: t('capabilities.mcp.edit'),
    },
    {
      key: 'delete',
      danger: true,
      disabled: server.readOnly,
      icon: <Trash2 size={14} />,
      label: t('capabilities.mcp.delete'),
    },
  ];
  const handleActionClick: NonNullable<MenuProps['onClick']> = ({ key }) => {
    if (key === 'edit') onEdit();
    if (key === 'delete') onDelete();
  };

  return (
    <>
      <CapabilitiesTopbarBreadcrumb currentLabel={server.label} parentLabel="MCP" onBack={onBack} />
      <section className="desktop-capabilities-detail desktop-capabilities-skill-detail desktop-capabilities-mcp-detail">
      <PageHeader
        title={server.label}
        subtitle={t(mcpSourceLabel(server.source))}
        actions={
          <>
            <label className="sd-check" title={t('capabilities.mcp.enableHint')}>
              <input
                type="checkbox"
                checked={server.enabled}
                disabled={server.readOnly}
                onChange={(event) => onUpdate({ enabled: event.currentTarget.checked })}
              />
              <span>{t('capabilities.mcp.enabled')}</span>
            </label>
            <Dropdown
              destroyOnHidden
              menu={{ items: actionItems, onClick: handleActionClick }}
              placement="bottomRight"
              trigger={['click']}
            >
              <IconButton label={t('capabilities.mcp.actions')}>
                <MoreHorizontal size={16} />
              </IconButton>
            </Dropdown>
          </>
        }
      />

      <McpDetailSection icon={<Settings2 size={14} />} title={t('capabilities.mcp.detail.configuration')}>
        <McpDetailGrid
          fields={[
            { label: t('capabilities.mcp.key'), value: server.key },
            { label: t('capabilities.mcp.name'), value: server.label },
            { label: t('capabilities.mcp.transport'), value: server.transport },
            { label: t('capabilities.mcp.description'), value: server.description, wide: true },
          ]}
        />
      </McpDetailSection>

      <McpDetailSection icon={<Plug size={14} />} title={t('capabilities.mcp.connection')}>
        <div className="desktop-capabilities-mcp-detail__connection">
          <McpDetailGrid
            fields={server.transport === 'stdio'
              ? [
                  { label: t('capabilities.mcp.command'), value: server.command },
                  { label: t('capabilities.mcp.args'), value: server.args },
                  { label: t('capabilities.mcp.cwd'), value: server.cwd },
                ]
                : [
                  { label: 'URL', value: endpoint, wide: true },
                ]}
          />
          {server.authError ? <small className="is-error">{server.authError}</small> : null}
          {canUseOAuth ? (
            server.authStatus === 'oAuth' ? (
              <Button type="button" variant="secondary" icon={<LogOut size={14} />} disabled={pending} onClick={onLogout}>
                {pending ? t('common.processing') : t('capabilities.mcp.logout')}
              </Button>
            ) : (
              <Button type="button" variant="secondary" icon={pending ? <Loader2 className="is-spinning" size={14} /> : <LogIn size={14} />} disabled={pending} onClick={onLogin}>
                {t(pending ? 'capabilities.mcp.awaitingAuthorization' : 'capabilities.mcp.login')}
              </Button>
            )
          ) : null}
        </div>
      </McpDetailSection>

      <McpDetailSection icon={<Clock3 size={14} />} title={t('capabilities.mcp.detail.timeouts')}>
        <McpDetailGrid
          fields={[
            { label: t('capabilities.mcp.requestTimeout'), value: `${server.timeoutMs} ms` },
            { label: t('capabilities.mcp.startupTimeout'), value: `${server.startupTimeoutMs} ms` },
            { label: t('capabilities.mcp.toolTimeout'), value: `${server.toolTimeoutMs} ms` },
          ]}
        />
      </McpDetailSection>

      <section className="desktop-capabilities-skill-section">
        <header>
          <span>{t('capabilities.mcp.tools')}</span>
          <small>{t('capabilities.mcp.toolsEnabled', { enabled: toolStats.enabled, total: toolStats.total })}</small>
        </header>
        {server.tools.length ? (
          <div className="desktop-capabilities-mcp-detail__tools">
            {server.tools.map((tool) => {
              const enabled = (!allowedTools.size || allowedTools.has(tool.name)) && !disabledTools.has(tool.name);
              return (
                <div key={tool.name} className={enabled ? '' : 'is-disabled'}>
                  <strong>{tool.title || tool.name}</strong>
                  {tool.description ? <span>{tool.description}</span> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="desktop-capabilities-skill-empty">{t('capabilities.mcp.toolsNotFetched')}</div>
        )}
      </section>
      </section>
    </>
  );
}

type McpDetailField = {
  label: string;
  value?: string | string[];
  wide?: boolean;
};

function McpDetailSection({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="desktop-capabilities-skill-section">
      <header>
        {icon}
        <span>{title}</span>
      </header>
      {children}
    </section>
  );
}

function McpDetailGrid({ fields }: { fields: McpDetailField[] }) {
  const visibleFields = fields.filter((field) => Array.isArray(field.value) ? field.value.length > 0 : Boolean(field.value));
  return (
    <dl className="desktop-capabilities-mcp-detail__grid">
      {visibleFields.map((field) => {
        const values = Array.isArray(field.value) ? field.value : field.value ? [field.value] : [];
        return (
          <div data-wide={field.wide || undefined} key={field.label}>
            <dt>{field.label}</dt>
            <dd>
              {values.map((value, index) => <code key={`${value}:${index}`}>{value}</code>)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function mcpSourceLabel(source: RuntimeMcpServer['source']):
  | 'capabilities.mcp.source.local'
  | 'capabilities.mcp.source.workspace'
  | 'capabilities.mcp.source.legacy'
  | 'capabilities.mcp.source.builtin' {
  const labels = {
    builtin: 'capabilities.mcp.source.builtin',
    legacy: 'capabilities.mcp.source.legacy',
    local: 'capabilities.mcp.source.local',
    workspace: 'capabilities.mcp.source.workspace',
  } as const satisfies Record<RuntimeMcpServer['source'], string>;
  return labels[source];
}

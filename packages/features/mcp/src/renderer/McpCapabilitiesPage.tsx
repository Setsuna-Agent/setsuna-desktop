import type {
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpToolInfo,
  RuntimeMcpTransport,
} from '@setsuna-desktop/contracts';
import type {
  McpRendererService,
} from '../contracts/index.js';
import type {
  CapabilitiesPageNavigation,
  SettingsPageSlotProps,
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import {
  Clock3,
  Loader2,
  LogIn,
  LogOut,
  MessageSquare,
  Pencil,
  Plug,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { McpTranslate } from './messages.js';

type McpDraft = Readonly<{
  allowedTools: string;
  args: string;
  bearerTokenEnvVar: string;
  command: string;
  cwd: string;
  description: string;
  disabledTools: string;
  enabled: boolean;
  env: string;
  envHttpHeaders: string;
  headers: string;
  key: string;
  label: string;
  oauthClientId: string;
  oauthResource: string;
  startupTimeoutMs: string;
  timeoutMs: string;
  toolTimeoutMs: string;
  tools: readonly RuntimeMcpToolInfo[];
  transport: RuntimeMcpTransport;
  url: string;
}>;

const emptyDraft: McpDraft = Object.freeze({
  allowedTools: '',
  args: '',
  bearerTokenEnvVar: '',
  command: '',
  cwd: '',
  description: '',
  disabledTools: '',
  enabled: true,
  env: '',
  envHttpHeaders: '',
  headers: '',
  key: '',
  label: '',
  oauthClientId: '',
  oauthResource: '',
  startupTimeoutMs: '',
  timeoutMs: '',
  toolTimeoutMs: '',
  tools: Object.freeze([]),
  transport: 'stdio',
  url: '',
});

export function McpCapabilitiesPage({
  capabilities,
  service,
  translate,
  ui,
}: SettingsPageSlotProps & Readonly<{ service: McpRendererService }>) {
  const snapshot = useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  );
  const [query, setQuery] = useState('');
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editingServer, setEditingServer] = useState<RuntimeMcpServer | null>(null);
  const [draft, setDraft] = useState<McpDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [authPendingKeys, setAuthPendingKeys] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (snapshot) return;
    void service.refresh().catch(() => undefined);
  }, [service, snapshot]);

  const servers = snapshot?.servers ?? [];
  const selectedServer = selectedKey
    ? servers.find((server) => server.key === selectedKey) ?? null
    : null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleServers = useMemo(() => servers.filter((server) => (
    !normalizedQuery
    || `${server.label} ${server.key} ${server.transport}`.toLocaleLowerCase().includes(normalizedQuery)
  )), [normalizedQuery, servers]);

  const closeEditor = () => {
    setEditingServer(null);
    setDraft(emptyDraft);
  };
  const openCreate = () => {
    setSelectedKey(null);
    setEditingServer(null);
    setDraft({ ...emptyDraft });
  };
  const openEditor = (server: RuntimeMcpServer) => {
    setEditingServer(server);
    setDraft(draftFromServer(server));
  };
  const save = async () => {
    const key = draft.key.trim();
    if (!key || saving) return;
    setSaving(true);
    try {
      await service.saveServer(draftToInput(draft, key, editingServer, translate));
      closeEditor();
    } finally {
      setSaving(false);
    }
  };
  const runAuth = async (server: RuntimeMcpServer, action: () => Promise<unknown>) => {
    setAuthPendingKeys((current) => new Set(current).add(server.key));
    try {
      await action();
    } finally {
      setAuthPendingKeys((current) => {
        const next = new Set(current);
        next.delete(server.key);
        return next;
      });
    }
  };

  if (editingServer || draft !== emptyDraft) {
    return (
      <McpServerEditor
        capabilities={capabilities}
        draft={draft}
        editingServer={editingServer}
        saving={saving}
        service={service}
        setDraft={setDraft}
        translate={translate}
        ui={ui}
        onBack={closeEditor}
        onSave={save}
      />
    );
  }

  if (selectedServer) {
    return (
      <McpServerDetail
        capabilities={capabilities}
        authPending={authPendingKeys.has(selectedServer.key)}
        server={selectedServer}
        translate={translate}
        ui={ui}
        onBack={() => setSelectedKey(null)}
        onDelete={async () => {
          if (!window.confirm(translate('feature.mcp.confirmDelete', { name: selectedServer.label }))) return;
          await service.deleteServer(selectedServer.key);
          setSelectedKey(null);
        }}
        onEdit={() => openEditor(selectedServer)}
        onLogin={() => runAuth(selectedServer, () => service.login(selectedServer.key))}
        onLogout={() => runAuth(selectedServer, () => service.logout(selectedServer.key))}
        onUpdate={(enabled) => service.updateServer(selectedServer.key, { enabled })}
      />
    );
  }

  return (
    <main className="capabilities-page desktop-capabilities-panel" data-feature-id="mcp">
      <section className={`desktop-capabilities-panel__inner desktop-capabilities-panel__inner--catalog${capabilities?.catalogNavigationInPage ? ' desktop-capabilities-panel__inner--page-tabs' : ''}`}>
        {capabilities?.catalogNavigation}
        <header className="desktop-capabilities-header">
          <div className="desktop-capabilities-title"><h2>MCP</h2></div>
          <div className="desktop-capabilities-actions">
            <ui.IconButton label={translate('feature.mcp.refresh')} onClick={() => void service.refresh()}>
              <RefreshCw size={15} />
            </ui.IconButton>
            {capabilities ? capabilities.renderCreateMenu({
              buttonLabel: translate('feature.mcp.create'),
              items: [
                {
                  description: translate('feature.mcp.createChatDescription'),
                  icon: <MessageSquare size={14} />,
                  id: 'chat-mcp',
                  onSelect: () => capabilities.openChat('create-mcp-in-chat'),
                  title: translate('feature.mcp.createChat'),
                },
                {
                  description: translate('feature.mcp.createFormDescription'),
                  icon: <Plug size={14} />,
                  id: 'form-mcp',
                  onSelect: openCreate,
                  title: translate('feature.mcp.createForm'),
                },
              ],
              onOpenChange: setCreateMenuOpen,
              open: createMenuOpen,
            }) : (
              <ui.Button variant="primary" icon={<Plug size={14} />} onClick={openCreate}>
                {translate('feature.mcp.add')}
              </ui.Button>
            )}
          </div>
        </header>
        <div className="desktop-capabilities-search-row">
          <label className="desktop-capabilities-search">
            <Search size={14} />
            <input
              aria-label={translate('feature.mcp.search')}
              placeholder={translate('feature.mcp.search')}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="desktop-capabilities-grid">
          <div className="desktop-capabilities-grid__content desktop-capability-list">
            {visibleServers.map((server) => (
              <McpServerListItem
                key={server.key}
                server={server}
                translate={translate}
                onOpen={() => setSelectedKey(server.key)}
                onUpdate={(enabled) => void service.updateServer(server.key, { enabled })}
              />
            ))}
            {!visibleServers.length ? (
              <div className="desktop-capabilities-empty">{translate('feature.mcp.empty')}</div>
            ) : null}
          </div>
        </div>
        {snapshot?.errors.length ? (
          <div className="desktop-capabilities-errors">
            {snapshot.errors.map((error) => <span key={error}>{error}</span>)}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function McpServerListItem({
  onOpen,
  onUpdate,
  server,
  translate,
}: Readonly<{
  onOpen(): void;
  onUpdate(enabled: boolean): void;
  server: RuntimeMcpServer;
  translate: McpTranslate;
}>) {
  const endpoint = server.transport === 'stdio'
    ? [server.command, ...server.args].filter(Boolean).join(' ')
    : server.url;
  const description = server.description || endpoint || translate('feature.mcp.noEndpoint');
  return (
    <article className="desktop-capability-list-item desktop-capability-list-item--mcp">
      <button className="desktop-capability-list-item__identity" type="button" onClick={onOpen}>
        <span aria-hidden="true" className="desktop-capability-list-item__icon" data-kind="mcp"><Plug size={18} /></span>
        <span className="desktop-capability-list-item__copy">
          <strong>{server.label}</strong>
          <span title={description}>{description}</span>
        </span>
      </button>
      <div className="desktop-capability-list-item__aside">
        <div className="desktop-capability-list-item__settings">
          <label className="sd-check" title={translate('feature.mcp.enableHint')}>
            <input
              checked={server.enabled}
              disabled={server.readOnly}
              type="checkbox"
              onChange={(event) => onUpdate(event.currentTarget.checked)}
            />
          </label>
        </div>
      </div>
    </article>
  );
}

function McpServerEditor({
  capabilities,
  draft,
  editingServer,
  onBack,
  onSave,
  saving,
  service,
  setDraft,
  translate,
  ui,
}: Readonly<{
  capabilities?: CapabilitiesPageNavigation;
  draft: McpDraft;
  editingServer: RuntimeMcpServer | null;
  onBack(): void;
  onSave(): Promise<void>;
  saving: boolean;
  service: McpRendererService;
  setDraft: Dispatch<SetStateAction<McpDraft>>;
  translate: McpTranslate;
  ui: SettingsViewUi;
}>) {
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const title = editingServer?.label || translate('feature.mcp.editor.new');
  const discover = async () => {
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      const result = await service.discoverTools(draftToInput(
        draft,
        draft.key.trim() || 'preview',
        editingServer,
        translate,
      ));
      setDraft((current) => ({ ...current, tools: result.tools }));
      if (result.errors.length) setDiscoveryError(result.errors.join('\n'));
    } catch (error) {
      setDiscoveryError(errorMessage(error));
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <main className="capabilities-page desktop-capabilities-panel" data-feature-id="mcp">
      <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
        {capabilities?.renderBreadcrumb({
          currentLabel: title,
          parentLabel: translate('feature.mcp.title'),
          onBack,
        })}
        <section className="desktop-capabilities-detail desktop-capabilities-mcp-editor">
          <ui.PageHeader
            actions={(
              <ui.Button
                disabled={saving || !draft.key.trim() || editingServer?.readOnly}
                icon={<Save size={15} />}
                variant="primary"
                onClick={() => void onSave()}
              >
                {translate(saving ? 'feature.mcp.saving' : 'feature.mcp.save')}
              </ui.Button>
            )}
            subtitle={translate(editingServer?.readOnly
              ? 'feature.mcp.editor.readOnly'
              : 'feature.mcp.editor.localOnly')}
            title={title}
          />
          <div className="mcp-form desktop-capabilities-mcp-form desktop-capabilities-mcp-form--page">
            <FormField help={translate('feature.mcp.keyHelp')} label={translate('feature.mcp.key')}>
              <ui.TextField
                disabled={Boolean(editingServer)}
                placeholder="server-key"
                value={draft.key}
                onChange={(event) => setDraftField(setDraft, 'key', event.currentTarget.value)}
              />
            </FormField>
            <FormField label={translate('feature.mcp.name')}>
              <ui.TextField placeholder="Search MCP" value={draft.label} onChange={(event) => setDraftField(setDraft, 'label', event.currentTarget.value)} />
            </FormField>
            <FormField label={translate('feature.mcp.transport')}>
              <ui.SelectField value={draft.transport} onValueChange={(value) => setDraftField(setDraft, 'transport', value as RuntimeMcpTransport)}>
                <option value="stdio">stdio</option>
                <option value="streamableHttp">streamable HTTP</option>
              </ui.SelectField>
            </FormField>
            <FormField className="desktop-capabilities-mcp-form__full" label={translate('feature.mcp.description')}>
              <ui.TextField placeholder={translate('feature.mcp.descriptionPlaceholder')} value={draft.description} onChange={(event) => setDraftField(setDraft, 'description', event.currentTarget.value)} />
            </FormField>
            {draft.transport === 'stdio' ? (
              <>
                <FormField label={translate('feature.mcp.command')}>
                  <ui.TextField value={draft.command} onChange={(event) => setDraftField(setDraft, 'command', event.currentTarget.value)} />
                </FormField>
                <FormField className="desktop-capabilities-mcp-form__wide" help={translate('feature.mcp.argsHelp')} label={translate('feature.mcp.args')}>
                  <ui.TextArea placeholder={'-y\n@example/mcp'} value={draft.args} onChange={(event) => setDraftField(setDraft, 'args', event.currentTarget.value)} />
                </FormField>
                <FormField label={translate('feature.mcp.cwd')}>
                  <ui.TextField value={draft.cwd} onChange={(event) => setDraftField(setDraft, 'cwd', event.currentTarget.value)} />
                </FormField>
                <FormField
                  className="desktop-capabilities-mcp-form__wide"
                  help={editingServer?.envKeys.length
                    ? translate('feature.mcp.envExisting', { keys: editingServer.envKeys.join(', ') })
                    : translate('feature.mcp.envHelp')}
                  label={translate('feature.mcp.env')}
                >
                  <ui.TextArea placeholder="API_KEY=value" value={draft.env} onChange={(event) => setDraftField(setDraft, 'env', event.currentTarget.value)} />
                </FormField>
              </>
            ) : (
              <>
                <FormField className="desktop-capabilities-mcp-form__full" label="URL">
                  <ui.TextField value={draft.url} onChange={(event) => setDraftField(setDraft, 'url', event.currentTarget.value)} />
                </FormField>
                <FormField
                  className="desktop-capabilities-mcp-form__full"
                  help={editingServer?.headerKeys.length
                    ? translate('feature.mcp.envExisting', { keys: editingServer.headerKeys.join(', ') })
                    : translate('feature.mcp.headersHelp')}
                  label={translate('feature.mcp.headers')}
                >
                  <ui.TextArea placeholder="Authorization=Bearer ..." value={draft.headers} onChange={(event) => setDraftField(setDraft, 'headers', event.currentTarget.value)} />
                </FormField>
                <FormField className="desktop-capabilities-mcp-form__full" help={translate('feature.mcp.envHeadersHelp')} label={translate('feature.mcp.envHeaders')}>
                  <ui.TextArea placeholder="X-API-Key=API_KEY" value={draft.envHttpHeaders} onChange={(event) => setDraftField(setDraft, 'envHttpHeaders', event.currentTarget.value)} />
                </FormField>
                <FormField label={translate('feature.mcp.bearerEnv')}>
                  <ui.TextField placeholder="MCP_ACCESS_TOKEN" value={draft.bearerTokenEnvVar} onChange={(event) => setDraftField(setDraft, 'bearerTokenEnvVar', event.currentTarget.value)} />
                </FormField>
                <FormField label="OAuth Client ID">
                  <ui.TextField value={draft.oauthClientId} onChange={(event) => setDraftField(setDraft, 'oauthClientId', event.currentTarget.value)} />
                </FormField>
                <FormField className="desktop-capabilities-mcp-form__full" label="OAuth Resource">
                  <ui.TextField value={draft.oauthResource} onChange={(event) => setDraftField(setDraft, 'oauthResource', event.currentTarget.value)} />
                </FormField>
              </>
            )}
            <FormField label={translate('feature.mcp.requestTimeout')}>
              <ui.TextField inputMode="numeric" placeholder="120000" value={draft.timeoutMs} onChange={(event) => setDraftField(setDraft, 'timeoutMs', event.currentTarget.value)} />
            </FormField>
            <FormField label={translate('feature.mcp.startupTimeout')}>
              <ui.TextField inputMode="numeric" placeholder="120000" value={draft.startupTimeoutMs} onChange={(event) => setDraftField(setDraft, 'startupTimeoutMs', event.currentTarget.value)} />
            </FormField>
            <FormField label={translate('feature.mcp.toolTimeout')}>
              <ui.TextField inputMode="numeric" placeholder="120000" value={draft.toolTimeoutMs} onChange={(event) => setDraftField(setDraft, 'toolTimeoutMs', event.currentTarget.value)} />
            </FormField>
            <section className="desktop-capabilities-mcp-tools">
              <header>
                <div>
                  <strong>{translate('feature.mcp.toolPermissions')}</strong>
                  <span>{translate('feature.mcp.toolPermissionsDescription')}</span>
                </div>
                <ui.Button disabled={discovering} icon={discovering ? <Loader2 className="is-spinning" size={14} /> : <RefreshCw size={14} />} onClick={() => void discover()}>
                  {translate(discovering ? 'feature.mcp.fetchingTools' : 'feature.mcp.fetchTools')}
                </ui.Button>
              </header>
              {discoveryError ? <div className="desktop-capabilities-mcp-tools__error">{discoveryError}</div> : null}
              {draft.tools.length ? (
                <>
                  <div className="desktop-capabilities-mcp-tools__toolbar">
                    <button type="button" onClick={() => setAllToolsEnabled(setDraft, true)}>{translate('feature.mcp.selectAll')}</button>
                    <button type="button" onClick={() => setAllToolsEnabled(setDraft, false)}>{translate('feature.mcp.selectNone')}</button>
                    <span>{translate('feature.mcp.toolsAvailable', {
                      enabled: draft.tools.length - splitList(draft.disabledTools, translate).length,
                      total: draft.tools.length,
                    })}</span>
                  </div>
                  <div className="desktop-capabilities-mcp-tools__list">
                    {draft.tools.map((tool) => (
                      <ui.Checkbox
                        checked={!splitList(draft.disabledTools, translate).includes(tool.name)}
                        className="desktop-capabilities-mcp-tool"
                        key={tool.name}
                        onChange={(enabled) => setToolEnabled(setDraft, tool.name, enabled, translate)}
                      >
                        <span><strong>{tool.name}</strong>{tool.description ? <small>{tool.description}</small> : null}</span>
                      </ui.Checkbox>
                    ))}
                  </div>
                </>
              ) : <div className="desktop-capabilities-mcp-tools__empty">{translate('feature.mcp.fetchToolsHint')}</div>}
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}

function McpServerDetail({
  authPending,
  capabilities,
  onBack,
  onDelete,
  onEdit,
  onLogin,
  onLogout,
  onUpdate,
  server,
  translate,
  ui,
}: Readonly<{
  authPending: boolean;
  capabilities?: CapabilitiesPageNavigation;
  onBack(): void;
  onDelete(): Promise<void>;
  onEdit(): void;
  onLogin(): Promise<void>;
  onLogout(): Promise<void>;
  onUpdate(enabled: boolean): Promise<unknown>;
  server: RuntimeMcpServer;
  translate: McpTranslate;
  ui: SettingsViewUi;
}>) {
  const canUseOAuth = server.transport === 'streamableHttp'
    && server.authStatus !== 'bearerToken'
    && server.authStatus !== 'unsupported';
  const loggedIn = server.authStatus === 'oAuth';
  const disabledTools = new Set(server.disabledTools);
  const allowedTools = new Set(server.allowedTools);
  const enabledToolCount = server.tools.filter((tool) => (
    (!allowedTools.size || allowedTools.has(tool.name)) && !disabledTools.has(tool.name)
  )).length;
  const actionItems = [
    {
      disabled: server.readOnly,
      icon: <Pencil size={14} />,
      id: 'edit',
      label: translate('feature.mcp.edit'),
    },
    {
      danger: true,
      disabled: server.readOnly,
      icon: <Trash2 size={14} />,
      id: 'delete',
      label: translate('feature.mcp.delete'),
    },
  ];
  return (
    <main className="capabilities-page desktop-capabilities-panel" data-feature-id="mcp">
      <section className="desktop-capabilities-panel__inner desktop-capabilities-panel__inner--detail">
        {capabilities?.renderBreadcrumb({
          currentLabel: server.label,
          parentLabel: translate('feature.mcp.title'),
          onBack,
        })}
        <section className="desktop-capabilities-detail desktop-capabilities-skill-detail desktop-capabilities-mcp-detail">
          <ui.PageHeader
            actions={(
              <>
                <label className="sd-check">
                  <input checked={server.enabled} disabled={server.readOnly} type="checkbox" onChange={(event) => void onUpdate(event.currentTarget.checked)} />
                  <span>{translate('feature.mcp.enabled')}</span>
                </label>
                <ui.ActionMenu
                  items={actionItems}
                  label={translate('feature.mcp.actions')}
                  onSelect={(actionId) => {
                    if (actionId === 'edit') onEdit();
                    if (actionId === 'delete') void onDelete();
                  }}
                />
              </>
            )}
            subtitle={translate(mcpSourceKey(server.source))}
            title={server.label}
          />

          <McpDetailSection icon={<Settings2 size={14} />} title={translate('feature.mcp.detail.configuration')}>
            <McpDetailGrid fields={[
              { label: translate('feature.mcp.key'), value: server.key },
              { label: translate('feature.mcp.name'), value: server.label },
              { label: translate('feature.mcp.transport'), value: server.transport },
              { label: translate('feature.mcp.description'), value: server.description, wide: true },
            ]} />
          </McpDetailSection>

          <McpDetailSection icon={<Plug size={14} />} title={translate('feature.mcp.connection')}>
            <div className="desktop-capabilities-mcp-detail__connection">
              <McpDetailGrid fields={server.transport === 'stdio'
                ? [
                    { label: translate('feature.mcp.command'), value: server.command },
                    { label: translate('feature.mcp.args'), value: server.args },
                    { label: translate('feature.mcp.cwd'), value: server.cwd },
                  ]
                : [{ label: 'URL', value: server.url, wide: true }]} />
              {server.authError ? <small className="is-error">{server.authError}</small> : null}
              {canUseOAuth ? (
                <ui.Button
                  disabled={authPending}
                  icon={authPending ? <Loader2 className="is-spinning" size={14} /> : loggedIn ? <LogOut size={14} /> : <LogIn size={14} />}
                  onClick={() => void (loggedIn ? onLogout() : onLogin())}
                >
                  {translate(authPending ? 'feature.mcp.awaitingAuthorization' : loggedIn ? 'feature.mcp.logout' : 'feature.mcp.login')}
                </ui.Button>
              ) : null}
            </div>
          </McpDetailSection>

          <McpDetailSection icon={<Clock3 size={14} />} title={translate('feature.mcp.detail.timeouts')}>
            <McpDetailGrid fields={[
              { label: translate('feature.mcp.requestTimeout'), value: `${server.timeoutMs} ms` },
              { label: translate('feature.mcp.startupTimeout'), value: `${server.startupTimeoutMs} ms` },
              { label: translate('feature.mcp.toolTimeout'), value: `${server.toolTimeoutMs} ms` },
            ]} />
          </McpDetailSection>
          <section className="desktop-capabilities-skill-section">
            <header>
              <span>{translate('feature.mcp.tools')}</span>
              <small>{translate('feature.mcp.toolsEnabled', { enabled: enabledToolCount, total: server.tools.length })}</small>
            </header>
            {server.tools.length ? (
              <div className="desktop-capabilities-mcp-detail__tools">
                {server.tools.map((tool) => {
                  const enabled = (!allowedTools.size || allowedTools.has(tool.name)) && !disabledTools.has(tool.name);
                  return <div className={enabled ? '' : 'is-disabled'} key={tool.name}><strong>{tool.title || tool.name}</strong>{tool.description ? <span>{tool.description}</span> : null}</div>;
                })}
              </div>
            ) : <div className="desktop-capabilities-skill-empty">{translate('feature.mcp.toolsNotFetched')}</div>}
          </section>
        </section>
      </section>
    </main>
  );
}

function FormField({ children, className = '', help, label }: Readonly<{
  children: ReactNode;
  className?: string;
  help?: string;
  label: string;
}>) {
  return <label className={`desktop-capabilities-mcp-field ${className}`}><span>{label}</span>{children}{help ? <small>{help}</small> : null}</label>;
}

type McpDetailField = Readonly<{
  label: string;
  value?: string | readonly string[];
  wide?: boolean;
}>;

function McpDetailSection({ children, icon, title }: Readonly<{
  children: ReactNode;
  icon: ReactNode;
  title: string;
}>) {
  return <section className="desktop-capabilities-skill-section"><header>{icon}<span>{title}</span></header>{children}</section>;
}

function McpDetailGrid({ fields }: Readonly<{ fields: readonly McpDetailField[] }>) {
  const visibleFields = fields.filter((field) => (
    typeof field.value === 'string' ? Boolean(field.value) : Boolean(field.value?.length)
  ));
  return (
    <dl className="desktop-capabilities-mcp-detail__grid">
      {visibleFields.map((field) => {
        const values = typeof field.value === 'string' ? [field.value] : field.value ?? [];
        return (
          <div data-wide={field.wide || undefined} key={field.label}>
            <dt>{field.label}</dt>
            <dd>{values.map((value, index) => <code key={`${value}:${index}`}>{value}</code>)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function setDraftField<TKey extends keyof McpDraft>(
  setDraft: Dispatch<SetStateAction<McpDraft>>,
  key: TKey,
  value: McpDraft[TKey],
) {
  setDraft((current) => ({ ...current, [key]: value }));
}

function setToolEnabled(
  setDraft: Dispatch<SetStateAction<McpDraft>>,
  toolName: string,
  enabled: boolean,
  translate: McpTranslate,
) {
  setDraft((current) => {
    const disabled = new Set(splitList(current.disabledTools, translate));
    if (enabled) disabled.delete(toolName);
    else disabled.add(toolName);
    return { ...current, disabledTools: [...disabled].sort().join('\n') };
  });
}

function setAllToolsEnabled(
  setDraft: Dispatch<SetStateAction<McpDraft>>,
  enabled: boolean,
) {
  setDraft((current) => ({
    ...current,
    allowedTools: '',
    disabledTools: enabled ? '' : current.tools.map((tool) => tool.name).join('\n'),
  }));
}

function mcpSourceKey(source: RuntimeMcpServer['source']):
  | 'feature.mcp.source.builtin'
  | 'feature.mcp.source.legacy'
  | 'feature.mcp.source.local'
  | 'feature.mcp.source.workspace' {
  return `feature.mcp.source.${source}`;
}

function draftFromServer(server: RuntimeMcpServer): McpDraft {
  return {
    allowedTools: server.allowedTools.join('\n'),
    args: server.args.join('\n'),
    bearerTokenEnvVar: '',
    command: server.command ?? '',
    cwd: server.cwd ?? '',
    description: server.description ?? '',
    disabledTools: server.disabledTools.join('\n'),
    enabled: server.enabled,
    env: '',
    envHttpHeaders: '',
    headers: '',
    key: server.key,
    label: server.label,
    oauthClientId: server.oauthClientId ?? '',
    oauthResource: server.oauthResource ?? '',
    startupTimeoutMs: server.startupTimeoutMs ? String(server.startupTimeoutMs) : '',
    timeoutMs: server.timeoutMs ? String(server.timeoutMs) : '',
    toolTimeoutMs: server.toolTimeoutMs ? String(server.toolTimeoutMs) : '',
    tools: server.tools,
    transport: server.transport,
    url: server.url ?? '',
  };
}

function draftToInput(
  draft: McpDraft,
  key: string,
  existing: RuntimeMcpServer | null,
  translate: McpTranslate,
): RuntimeMcpServerInput {
  const base = {
    allowedTools: splitList(draft.allowedTools, translate),
    description: optionalText(draft.description),
    disabledTools: splitList(draft.disabledTools, translate),
    enabled: draft.enabled,
    key,
    label: draft.label.trim() || key,
    startupTimeoutMs: optionalNumber(draft.startupTimeoutMs),
    timeoutMs: optionalNumber(draft.timeoutMs),
    toolTimeoutMs: optionalNumber(draft.toolTimeoutMs),
    tools: [...draft.tools],
    transport: draft.transport,
  };
  return draft.transport === 'stdio'
    ? {
        ...base,
        args: splitList(draft.args, translate),
        command: draft.command.trim(),
        cwd: optionalText(draft.cwd),
        ...(!existing || draft.env.trim() ? { env: keyValueLines(draft.env) } : {}),
      }
    : {
        ...base,
        url: draft.url.trim(),
        ...(!existing || draft.headers.trim() ? { headers: keyValueLines(draft.headers) } : {}),
        ...(draft.envHttpHeaders.trim() ? { envHttpHeaders: keyValueLines(draft.envHttpHeaders) } : {}),
        ...(draft.bearerTokenEnvVar.trim() ? { bearerTokenEnvVar: draft.bearerTokenEnvVar.trim() } : {}),
        ...(draft.oauthClientId.trim() ? { oauthClientId: draft.oauthClientId.trim() } : {}),
        ...(draft.oauthResource.trim() ? { oauthResource: draft.oauthResource.trim() } : {}),
      };
}

function splitList(value: string, translate: McpTranslate): string[] {
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error(translate('feature.mcp.invalidArgs'));
    return parsed.map(String);
  }
  return text.split(/\r?\n|,/u).map((item) => item.trim()).filter(Boolean);
}

function optionalText(value: string): string | undefined {
  return value.trim() || undefined;
}

function optionalNumber(value: string): number | undefined {
  const numeric = Number(value.trim());
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined;
}

function keyValueLines(value: string): Record<string, string> | undefined {
  const entries = value.split('\n').flatMap((line) => {
    const separator = line.indexOf('=');
    if (separator < 1) return [];
    const key = line.slice(0, separator).trim();
    const entryValue = line.slice(separator + 1).trim();
    return key && entryValue ? [[key, entryValue] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

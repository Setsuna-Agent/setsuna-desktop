import type {
  RuntimePluginFilePreview,
  RuntimePluginHook,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginResource,
  RuntimePluginSkill,
} from '@setsuna-desktop/contracts';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import {
  FileText,
  Loader2,
  Power,
  PowerOff,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  PluginManagementHook,
  PluginManagementRendererService,
} from '../contracts/index.js';
import type { PluginManagementTranslate } from './messages.js';
import {
  formatPluginFileSize,
  matchingPluginHook,
  type PluginMcpDetail,
} from './pluginPresentation.js';

export type PluginDetailItem =
  | Readonly<{ kind: 'hook'; value: RuntimePluginHook }>
  | Readonly<{ kind: 'mcp'; value: PluginMcpDetail }>
  | Readonly<{ kind: 'resource'; value: RuntimePluginResource }>
  | Readonly<{ kind: 'skill'; value: RuntimePluginSkill }>;

export function PluginItemDialog({
  hooks,
  installed,
  item,
  onClose,
  openExternal,
  onSetHookEnabled,
  onSetHookTrust,
  pluginId,
  service,
  translate,
  ui,
}: Readonly<{
  installed: boolean;
  hooks: readonly PluginManagementHook[];
  item: PluginDetailItem;
  onClose(): void;
  openExternal(url: string): Promise<boolean>;
  onSetHookEnabled(hook: PluginManagementHook, enabled: boolean): Promise<void>;
  onSetHookTrust(hook: PluginManagementHook, trusted: boolean): Promise<void>;
  pluginId: string;
  service: PluginManagementRendererService;
  translate: PluginManagementTranslate;
  ui: SettingsViewUi;
}>) {
  const [content, setContent] = useState<RuntimePluginItemContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hookActionPending, setHookActionPending] = useState(false);
  const itemId = item.kind === 'mcp' ? item.value.key : item.value.id;
  const activeHook = item.kind === 'hook'
    ? matchingPluginHook(hooks, pluginId, item.value)
    : undefined;
  const hookTrusted = activeHook?.trustStatus === 'trusted' || activeHook?.trustStatus === 'managed';

  const runHookAction = async (operation: () => Promise<void>) => {
    if (hookActionPending) return;
    setHookActionPending(true);
    setError(null);
    try {
      await operation();
    } catch (unknownError) {
      setError(errorMessage(unknownError));
    } finally {
      setHookActionPending(false);
    }
  };

  useEffect(() => {
    let active = true;
    setContent(null);
    setError(null);
    setLoading(true);
    const load = installed ? service.getInstalledItem.bind(service) : service.getMarketplaceItem.bind(service);
    void load({ itemId, kind: item.kind, pluginId })
      .then((result) => {
        if (active) setContent(result);
      })
      .catch((unknownError) => {
        if (active) setError(errorMessage(unknownError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [installed, item.kind, itemId, pluginId, service]);

  return (
    <ui.Dialog
      className="desktop-plugin-item-dialog"
      closeLabel={translate('feature.pluginManagement.close')}
      onClose={onClose}
      size="large"
      title={itemTitle(item)}
      titleIcon={<FileText size={17} />}
      subtitle={itemKindLabel(item.kind, translate)}
      footer={(
        <>
          {activeHook && !activeHook.isManaged ? (
            <ui.Button
              disabled={hookActionPending}
              icon={hookActionPending
                ? <Loader2 className="is-spinning" size={14} />
                : hookTrusted ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
              variant={hookTrusted ? 'secondary' : 'primary'}
              onClick={() => void runHookAction(() => onSetHookTrust(activeHook, !hookTrusted))}
            >
              {translate(hookTrusted
                ? 'feature.pluginManagement.untrustHook'
                : 'feature.pluginManagement.trustHook')}
            </ui.Button>
          ) : null}
          {activeHook ? (
            <ui.Button
              disabled={hookActionPending}
              icon={hookActionPending
                ? <Loader2 className="is-spinning" size={14} />
                : activeHook.enabled ? <PowerOff size={14} /> : <Power size={14} />}
              variant="secondary"
              onClick={() => void runHookAction(() => onSetHookEnabled(activeHook, !activeHook.enabled))}
            >
              {translate(activeHook.enabled
                ? 'feature.pluginManagement.disableHook'
                : 'feature.pluginManagement.enableHook')}
            </ui.Button>
          ) : null}
          <ui.Button variant="secondary" onClick={onClose}>{translate('feature.pluginManagement.close')}</ui.Button>
        </>
      )}
    >
      <div className="desktop-plugin-item-dialog__body">
        {itemDescription(item) ? <p className="desktop-plugin-item-dialog__description">{itemDescription(item)}</p> : null}
        {activeHook?.command ? (
          <section className="desktop-plugin-item-dialog__section">
            <header><strong>{translate('feature.pluginManagement.hookCommand')}</strong></header>
            <pre tabIndex={0}>{activeHook.command}</pre>
          </section>
        ) : null}
        {loading ? (
          <div className="desktop-plugin-item-dialog__status"><Loader2 className="is-spinning" size={14} />{translate('feature.pluginManagement.loading')}</div>
        ) : error ? (
          <ui.EmptyState title={translate('feature.pluginManagement.error.generic')} body={error} />
        ) : content?.files.length ? (
          <div className="desktop-plugin-item-dialog__files">
            {content.files.map((file) => (
              <PluginFilePreview
                file={file}
                key={file.path}
                openExternal={openExternal}
                translate={translate}
              />
            ))}
          </div>
        ) : (
          <div className="desktop-plugin-item-dialog__status">{translate('feature.pluginManagement.noItems')}</div>
        )}
      </div>
    </ui.Dialog>
  );
}

function PluginFilePreview({
  file,
  openExternal,
  translate,
}: Readonly<{
  file: RuntimePluginFilePreview;
  openExternal(url: string): Promise<boolean>;
  translate: PluginManagementTranslate;
}>) {
  const [source, setSource] = useState(false);
  const markdown = file.text !== undefined && isMarkdownFile(file);
  const name = file.path.split(/[\\/]/u).at(-1) || file.path;
  const markdownComponents = useMemo<NonNullable<ComponentProps<typeof ReactMarkdown>['components']>>(
    () => ({
      a: (props) => <PluginMarkdownLink {...props} openExternal={openExternal} />,
    }),
    [openExternal],
  );
  return (
    <article className="desktop-plugin-item-dialog__file">
      <header>
        <span className="desktop-plugin-item-dialog__file-heading">
          <span className="desktop-plugin-item-dialog__file-name">{name}</span>
          <small>{file.mimeType} · {formatPluginFileSize(file.size)}</small>
        </span>
        {markdown ? (
          <span className="desktop-plugin-item-dialog__view-switch" role="group" aria-label={name}>
            <button
              aria-pressed={!source}
              className={!source ? 'is-active' : undefined}
              type="button"
              onClick={() => setSource(false)}
            >
              {translate('feature.pluginManagement.preview')}
            </button>
            <button
              aria-pressed={source}
              className={source ? 'is-active' : undefined}
              type="button"
              onClick={() => setSource(true)}
            >
              {translate('feature.pluginManagement.source')}
            </button>
          </span>
        ) : null}
      </header>
      {file.base64 && file.mimeType.startsWith('image/') ? (
        <div className="desktop-plugin-item-dialog__image-wrap"><img alt={name} src={`data:${file.mimeType};base64,${file.base64}`} /></div>
      ) : markdown && !source ? (
        <div className="chat-markdown desktop-plugin-item-dialog__markdown">
          <ReactMarkdown
            components={markdownComponents}
            remarkPlugins={[remarkGfm]}
          >
            {markdownPreviewBody(file.text ?? '')}
          </ReactMarkdown>
        </div>
      ) : file.text !== undefined ? (
        <pre tabIndex={0}>{file.text}</pre>
      ) : (
        <div className="desktop-plugin-item-dialog__status">{translate('feature.pluginManagement.previewUnavailable')}</div>
      )}
    </article>
  );
}

function PluginMarkdownLink({
  children,
  href,
  node: _node,
  onClick,
  openExternal,
  ...props
}: ComponentProps<'a'> & Readonly<{
  node?: unknown;
  openExternal(url: string): Promise<boolean>;
}>) {
  const external = href && /^(?:https?:|mailto:)/iu.test(href);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (!external) return;
    void openExternal(href).catch((error: unknown) => {
      console.error('[plugin-management] failed to open external link', error);
    });
  };
  return (
    <a
      {...props}
      aria-disabled={external ? undefined : true}
      href={external ? href : undefined}
      rel="noreferrer"
      target={external ? '_blank' : undefined}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

function itemTitle(item: PluginDetailItem): string {
  if (item.kind === 'mcp') return item.value.label;
  if (item.kind === 'resource') return item.value.label;
  return item.value.name;
}

function itemDescription(item: PluginDetailItem): string | undefined {
  return item.kind === 'resource' ? item.value.path : item.value.description;
}

function itemKindLabel(kind: RuntimePluginItemKind, translate: PluginManagementTranslate): string {
  if (kind === 'skill') return translate('feature.pluginManagement.skills');
  if (kind === 'mcp') return translate('feature.pluginManagement.mcpServers');
  if (kind === 'hook') return translate('feature.pluginManagement.hooks');
  return translate('feature.pluginManagement.resources');
}

function isMarkdownFile(file: RuntimePluginFilePreview): boolean {
  const mime = file.mimeType.split(';', 1)[0]?.trim().toLocaleLowerCase();
  return mime === 'text/markdown' || /\.(?:md|markdown|mdown|mkd|mdx)$/iu.test(file.path);
}

function markdownPreviewBody(content: string): string {
  const frontmatter = content.match(/^---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/u);
  return frontmatter?.[1] && /^(?:[A-Za-z_][\w.-]*):(?:[\t ]|$)/mu.test(frontmatter[1])
    ? content.slice(frontmatter[0].length)
    : content;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

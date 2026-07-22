import type {
  RuntimeHookMetadata,
  RuntimeMcpServer,
  RuntimePluginFilePreview,
  RuntimePluginHook,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginMcpServerDescriptor,
  RuntimePluginResource,
  RuntimePluginSkill,
} from '@setsuna-desktop/contracts';
import { BookOpen, FileText, Loader2, Plug, Workflow, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { Button, IconButton } from '../../shared/ui/primitives.js';
import { MarkdownContentBlock } from '../chat/markdown/MarkdownContentBlock.js';
import { formatPluginFileSize } from './pluginDisplay.js';

type PluginMcpItem = RuntimePluginMcpServerDescriptor & { owned?: boolean };

export type CapabilitiesPluginItem =
  | { kind: 'skill'; value: RuntimePluginSkill }
  | { kind: 'mcp'; value: PluginMcpItem }
  | { kind: 'hook'; value: RuntimePluginHook }
  | { kind: 'resource'; value: RuntimePluginResource };

export function CapabilitiesPluginItemDialog({
  item,
  mcpServers,
  onClose,
  onGetContent,
  pluginId,
  runtimeHooks,
  trustHooksOnInstall,
}: {
  item: CapabilitiesPluginItem;
  mcpServers: RuntimeMcpServer[];
  onClose: () => void;
  onGetContent?: (kind: RuntimePluginItemKind, itemId: string) => Promise<RuntimePluginItemContent>;
  pluginId: string;
  runtimeHooks: RuntimeHookMetadata[];
  trustHooksOnInstall: boolean;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState<RuntimePluginItemContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(onGetContent));
  const previousFocusRef = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const itemId = pluginItemId(item);
  const title = pluginItemTitle(item);
  const description = pluginItemDescription(item);
  const activeMcpServer = item.kind === 'mcp'
    ? mcpServers.find((server) => server.key === item.value.key)
    : undefined;
  const activeHook = item.kind === 'hook'
    ? matchingRuntimeHook(runtimeHooks, pluginId, item.value)
    : undefined;
  const configPreview = pluginItemConfig(item, activeMcpServer, activeHook);

  useEffect(() => {
    if (!onGetContent) {
      setLoading(false);
      return undefined;
    }
    let current = true;
    setContent(null);
    setError(null);
    setLoading(true);
    void onGetContent(item.kind, itemId)
      .then((nextContent) => {
        if (current) setContent(nextContent);
      })
      .catch((unknownError) => {
        if (current) setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [item.kind, itemId, onGetContent]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => () => previousFocusRef.current?.focus(), []);

  const dialog = (
    <div className="desktop-agent-modal-backdrop desktop-plugin-item-dialog__backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="desktop-agent-modal desktop-plugin-item-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-plugin-item-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="desktop-plugin-item-dialog__header">
          <span className="desktop-plugin-item-dialog__icon">{pluginItemIcon(item.kind)}</span>
          <span className="desktop-plugin-item-dialog__title">
            <small>{pluginItemKindLabel(item.kind, t)}</small>
            <strong id="desktop-plugin-item-dialog-title">{title}</strong>
          </span>
          <IconButton autoFocus label={t('capabilities.item.closeDetail')} onClick={onClose}><X size={16} /></IconButton>
        </header>

        <div className="desktop-plugin-item-dialog__body">
          {description ? <p className="desktop-plugin-item-dialog__description">{description}</p> : null}
          <dl className="desktop-plugin-item-dialog__metadata">
            {pluginItemMetadata(item, activeMcpServer, activeHook, trustHooksOnInstall, t).map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>

          {configPreview ? (
            <section className="desktop-plugin-item-dialog__section">
              <header><strong>{t('capabilities.item.config')}</strong></header>
              <pre>{configPreview}</pre>
            </section>
          ) : null}

          <section className="desktop-plugin-item-dialog__section">
            <header>
              <strong>{t('capabilities.item.preview')}</strong>
              {content?.files.length ? <small>{t('capabilities.item.fileCount', { count: content.files.length })}</small> : null}
            </header>
            {loading ? (
              <div className="desktop-plugin-item-dialog__status"><Loader2 className="is-spinning" size={14} />{t('capabilities.item.reading')}</div>
            ) : error ? (
              <div className="desktop-plugin-item-dialog__status is-error">{t('capabilities.item.previewError', { error })}</div>
            ) : content?.files.length ? (
              <div className="desktop-plugin-item-dialog__files">
                {content.files.map((file) => (
                  <CapabilitiesPluginFilePreview file={file} key={file.path} />
                ))}
              </div>
            ) : (
              <div className="desktop-plugin-item-dialog__status">{t('capabilities.item.noSafeFiles')}</div>
            )}
          </section>
        </div>

        <footer><Button type="button" variant="secondary" onClick={onClose}>{t('common.close')}</Button></footer>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

export function CapabilitiesPluginFilePreview({ file }: { file: RuntimePluginFilePreview }) {
  const { t } = useI18n();
  const [markdownView, setMarkdownView] = useState<'preview' | 'source'>('preview');
  const markdown = file.text !== undefined && isMarkdownFile(file);
  const markdownBody = markdown ? markdownPreviewBody(file.text ?? '') : '';
  const name = fileName(file.path);

  return (
    <article className="desktop-plugin-item-dialog__file">
      <header>
        <span className="desktop-plugin-item-dialog__file-heading">
          <span className="desktop-plugin-item-dialog__file-name">{name}</span>
          <small>{file.mimeType} · {formatPluginFileSize(file.size)}</small>
        </span>
        {markdown ? (
          <span className="desktop-plugin-item-dialog__view-switch" role="group" aria-label={t('capabilities.item.displayMode', { name })}>
            <button
              className={markdownView === 'preview' ? 'is-active' : undefined}
              type="button"
              aria-pressed={markdownView === 'preview'}
              onClick={() => setMarkdownView('preview')}
            >
              {t('capabilities.item.previewMode')}
            </button>
            <button
              className={markdownView === 'source' ? 'is-active' : undefined}
              type="button"
              aria-pressed={markdownView === 'source'}
              onClick={() => setMarkdownView('source')}
            >
              {t('capabilities.item.sourceMode')}
            </button>
          </span>
        ) : null}
      </header>
      {file.base64 && file.mimeType.startsWith('image/') ? (
        <div className="desktop-plugin-item-dialog__image-wrap">
          <img src={`data:${file.mimeType};base64,${file.base64}`} alt={name} />
        </div>
      ) : markdown && markdownView === 'preview' ? (
        markdownBody.trim() ? (
          <div className="chat-markdown desktop-plugin-item-dialog__markdown">
            <div className="chat-markdown__block">
              <MarkdownContentBlock content={markdownBody} />
            </div>
          </div>
        ) : (
          <div className="desktop-plugin-item-dialog__status">{t('capabilities.item.emptyMarkdown')}</div>
        )
      ) : file.text !== undefined ? (
        file.text ? (
          <pre aria-label={t('capabilities.item.fileContent', { name })} tabIndex={0}>{file.text}</pre>
        ) : <div className="desktop-plugin-item-dialog__status">{t('capabilities.item.emptyFile')}</div>
      ) : (
        <div className="desktop-plugin-item-dialog__status">{t('capabilities.item.unsupportedPreview')}</div>
      )}
    </article>
  );
}

export function markdownPreviewBody(content: string): string {
  const frontmatter = content.match(/^---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/u);
  const looksLikeYaml = frontmatter?.[1] && /^(?:[A-Za-z_][\w.-]*):(?:[\t ]|$)/mu.test(frontmatter[1]);
  return frontmatter && looksLikeYaml ? content.slice(frontmatter[0].length) : content;
}

function isMarkdownFile(file: RuntimePluginFilePreview): boolean {
  const mimeType = file.mimeType.split(';', 1)[0].trim().toLowerCase();
  return mimeType === 'text/markdown'
    || mimeType === 'text/x-markdown'
    || /\.(?:md|markdown|mdown|mkd|mdx)$/iu.test(file.path);
}

function pluginItemId(item: CapabilitiesPluginItem): string {
  return item.kind === 'mcp' ? item.value.key : item.value.id;
}

function pluginItemTitle(item: CapabilitiesPluginItem): string {
  if (item.kind === 'mcp') return item.value.label;
  return item.kind === 'resource' ? item.value.label : item.value.name;
}

function pluginItemDescription(item: CapabilitiesPluginItem): string | undefined {
  if (item.kind === 'resource') return undefined;
  return item.value.description;
}

function pluginItemIcon(kind: RuntimePluginItemKind) {
  if (kind === 'skill') return <BookOpen size={17} />;
  if (kind === 'mcp') return <Plug size={17} />;
  if (kind === 'hook') return <Workflow size={17} />;
  return <FileText size={17} />;
}

function pluginItemKindLabel(kind: RuntimePluginItemKind, t: Translate): string {
  if (kind === 'skill') return t('capabilities.item.kind.skill');
  if (kind === 'mcp') return t('capabilities.item.kind.mcp');
  if (kind === 'hook') return t('capabilities.item.kind.hook');
  return t('capabilities.item.kind.resource');
}

function pluginItemMetadata(
  item: CapabilitiesPluginItem,
  activeMcpServer: RuntimeMcpServer | undefined,
  activeHook: RuntimeHookMetadata | undefined,
  trustHooksOnInstall: boolean,
  t: Translate,
): Array<[string, string]> {
  if (item.kind === 'skill') return [['ID', item.value.id], [t('capabilities.item.meta.file'), 'SKILL.md']];
  if (item.kind === 'mcp') {
    return [
      ['Key', item.value.key],
      [t('capabilities.item.meta.transport'), t(item.value.transport === 'streamableHttp' ? 'capabilities.item.remoteHttp' : 'capabilities.item.localStdio')],
      [t('capabilities.item.meta.status'), activeMcpServer
        ? t(activeMcpServer.enabled ? 'capabilities.item.enabled' : 'capabilities.item.disabled')
        : t('capabilities.item.availableAfterInstall')],
      ...(item.value.owned === false ? [[t('capabilities.item.meta.source'), t('capabilities.detail.reuseExisting')] as [string, string]] : []),
    ];
  }
  if (item.kind === 'hook') {
    return [
      ['ID', item.value.id],
      [t('capabilities.item.meta.event'), item.value.eventName],
      ['Matcher', item.value.matcher || t('capabilities.item.meta.all')],
      [t('capabilities.item.meta.status'), activeHook
        ? (activeHook.enabled ? hookTrustLabel(activeHook.trustStatus, t) : t('capabilities.item.disabled'))
        : t(trustHooksOnInstall ? 'capabilities.item.autoTrustOnInstall' : 'capabilities.item.trustAfterInstall')],
    ];
  }
  return [['ID', item.value.id], [t('capabilities.item.meta.path'), item.value.path], [t('capabilities.item.meta.size'), formatPluginFileSize(item.value.size)]];
}

function pluginItemConfig(
  item: CapabilitiesPluginItem,
  activeMcpServer: RuntimeMcpServer | undefined,
  activeHook: RuntimeHookMetadata | undefined,
): string | null {
  if (item.kind === 'mcp') {
    return JSON.stringify(removeUndefined({
      transport: item.value.transport,
      url: activeMcpServer?.url,
      command: activeMcpServer?.command,
      args: activeMcpServer?.args,
      cwd: activeMcpServer?.cwd,
      enabled: activeMcpServer?.enabled,
      requireApproval: activeMcpServer?.requireApproval,
      trustLevel: activeMcpServer?.trustLevel,
      allowedTools: activeMcpServer?.allowedTools,
      disabledTools: activeMcpServer?.disabledTools,
    }), null, 2);
  }
  if (item.kind === 'hook') {
    return JSON.stringify(removeUndefined({
      eventName: item.value.eventName,
      matcher: item.value.matcher,
      command: activeHook?.command,
      timeoutSec: activeHook?.timeoutSec,
      statusMessage: item.value.statusMessage ?? activeHook?.statusMessage,
      enabled: activeHook?.enabled,
      trustStatus: activeHook?.trustStatus,
    }), null, 2);
  }
  return null;
}

function matchingRuntimeHook(
  hooks: RuntimeHookMetadata[],
  pluginId: string,
  item: RuntimePluginHook,
): RuntimeHookMetadata | undefined {
  const eventName = `${item.eventName[0].toLowerCase()}${item.eventName.slice(1)}`;
  return hooks.find((hook) => hook.pluginId === pluginId
    && hook.eventName === eventName
    && (hook.matcher ?? '') === (item.matcher ?? ''));
}

function hookTrustLabel(status: RuntimeHookMetadata['trustStatus'], t: Translate): string {
  if (status === 'trusted' || status === 'managed') return t('capabilities.item.trusted');
  if (status === 'modified') return t('capabilities.item.commandChanged');
  return t('capabilities.item.awaitingTrust');
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/u).at(-1) || filePath;
}

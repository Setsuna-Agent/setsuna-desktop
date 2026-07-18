import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, FileText, Loader2, Plug, Workflow, X } from 'lucide-react';
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
import { MarkdownContentBlock } from '../chat/markdown/MarkdownContentBlock.js';
import { Button, IconButton } from '../primitives.js';
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
            <small>{pluginItemKindLabel(item.kind)}</small>
            <strong id="desktop-plugin-item-dialog-title">{title}</strong>
          </span>
          <IconButton autoFocus label="关闭详情" onClick={onClose}><X size={16} /></IconButton>
        </header>

        <div className="desktop-plugin-item-dialog__body">
          {description ? <p className="desktop-plugin-item-dialog__description">{description}</p> : null}
          <dl className="desktop-plugin-item-dialog__metadata">
            {pluginItemMetadata(item, activeMcpServer, activeHook, trustHooksOnInstall).map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>

          {configPreview ? (
            <section className="desktop-plugin-item-dialog__section">
              <header><strong>配置详情</strong></header>
              <pre>{configPreview}</pre>
            </section>
          ) : null}

          <section className="desktop-plugin-item-dialog__section">
            <header>
              <strong>内容预览</strong>
              {content?.files.length ? <small>{content.files.length} 个文件</small> : null}
            </header>
            {loading ? (
              <div className="desktop-plugin-item-dialog__status"><Loader2 className="is-spinning" size={14} />正在读取插件内容</div>
            ) : error ? (
              <div className="desktop-plugin-item-dialog__status is-error">当前内容无法预览：{error}</div>
            ) : content?.files.length ? (
              <div className="desktop-plugin-item-dialog__files">
                {content.files.map((file) => (
                  <CapabilitiesPluginFilePreview file={file} key={file.path} />
                ))}
              </div>
            ) : (
              <div className="desktop-plugin-item-dialog__status">这项能力没有关联可安全预览的本地文件。</div>
            )}
          </section>
        </div>

        <footer><Button type="button" variant="secondary" onClick={onClose}>关闭</Button></footer>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

export function CapabilitiesPluginFilePreview({ file }: { file: RuntimePluginFilePreview }) {
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
          <span className="desktop-plugin-item-dialog__view-switch" role="group" aria-label={`${name} 显示方式`}>
            <button
              className={markdownView === 'preview' ? 'is-active' : undefined}
              type="button"
              aria-pressed={markdownView === 'preview'}
              onClick={() => setMarkdownView('preview')}
            >
              预览
            </button>
            <button
              className={markdownView === 'source' ? 'is-active' : undefined}
              type="button"
              aria-pressed={markdownView === 'source'}
              onClick={() => setMarkdownView('source')}
            >
              源码
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
          <div className="desktop-plugin-item-dialog__status">Markdown 正文为空。</div>
        )
      ) : file.text !== undefined ? (
        file.text ? (
          <pre aria-label={`${name} 文件内容`} tabIndex={0}>{file.text}</pre>
        ) : <div className="desktop-plugin-item-dialog__status">这是一个空文件。</div>
      ) : (
        <div className="desktop-plugin-item-dialog__status">这个文件格式暂不支持内嵌预览。</div>
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

function pluginItemKindLabel(kind: RuntimePluginItemKind): string {
  if (kind === 'skill') return 'Skill';
  if (kind === 'mcp') return 'MCP 服务';
  if (kind === 'hook') return 'Hook';
  return '资源文件';
}

function pluginItemMetadata(
  item: CapabilitiesPluginItem,
  activeMcpServer: RuntimeMcpServer | undefined,
  activeHook: RuntimeHookMetadata | undefined,
  trustHooksOnInstall: boolean,
): Array<[string, string]> {
  if (item.kind === 'skill') return [['ID', item.value.id], ['文件', 'SKILL.md']];
  if (item.kind === 'mcp') {
    return [
      ['Key', item.value.key],
      ['传输', item.value.transport === 'streamableHttp' ? '远程 HTTP' : '本地 stdio'],
      ['状态', activeMcpServer ? (activeMcpServer.enabled ? '已启用' : '已停用') : '安装后可用'],
      ...(item.value.owned === false ? [['来源', '复用现有配置'] as [string, string]] : []),
    ];
  }
  if (item.kind === 'hook') {
    return [
      ['ID', item.value.id],
      ['事件', item.value.eventName],
      ['Matcher', item.value.matcher || '全部'],
      ['状态', activeHook
        ? (activeHook.enabled ? hookTrustLabel(activeHook.trustStatus) : '已停用')
        : trustHooksOnInstall ? '安装时自动信任' : '安装后需信任'],
    ];
  }
  return [['ID', item.value.id], ['路径', item.value.path], ['大小', formatPluginFileSize(item.value.size)]];
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

function hookTrustLabel(status: RuntimeHookMetadata['trustStatus']): string {
  if (status === 'trusted' || status === 'managed') return '已信任';
  if (status === 'modified') return '命令已变更';
  return '等待信任';
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/u).at(-1) || filePath;
}

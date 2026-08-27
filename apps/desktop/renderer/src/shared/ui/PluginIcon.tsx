import type { LucideIcon } from 'lucide-react';
import {
  BookOpenText,
  Braces,
  Compass,
  Eye,
  FileSearch,
  FolderLock,
  FolderX,
  Globe,
  ListTodo,
  ListX,
  MessageCircleQuestion,
  ScanSearch,
  ScrollText,
  ShieldAlert,
  Shrink,
  Sparkles,
} from 'lucide-react';
import { getIcon } from 'seti-file-icons';
import openaiLogoUrl from '../assets/provider-logos/openai.svg';

const pluginIconNames = [
  'context7',
  'openai-docs',
  'pdf',
  'documents',
  'image-generation',
  'vision-recognition',
  'web-search',
  'guard-dangerous-shell',
  'protect-secret-paths',
  'protect-generated-folders',
  'audit-file-mutations',
  'session-start-project-guidance',
  'prompt-secret-detector',
  'compact-warning',
  'stop-todo-continuation',
  'question',
  'todo',
  'claude-rules',
] as const;

type PluginIconName = typeof pluginIconNames[number];
type PluginIconVariant = 'card' | 'detail' | 'inline' | 'installed' | 'list' | 'menu';

const pluginGlyphs: Partial<Record<PluginIconName, LucideIcon>> = {
  context7: Braces,
  'openai-docs': BookOpenText,
  'image-generation': Sparkles,
  'vision-recognition': Eye,
  'web-search': Globe,
  'guard-dangerous-shell': ShieldAlert,
  'protect-secret-paths': FolderLock,
  'protect-generated-folders': FolderX,
  'audit-file-mutations': FileSearch,
  'session-start-project-guidance': Compass,
  'prompt-secret-detector': ScanSearch,
  'compact-warning': Shrink,
  'stop-todo-continuation': ListX,
  question: MessageCircleQuestion,
  todo: ListTodo,
  'claude-rules': ScrollText,
};

const knownPluginIcons = new Set<string>(pluginIconNames);
const pluginIconById: Partial<Record<string, PluginIconName>> = {
  'context7-docs': 'context7',
  'openai-image-generation': 'image-generation',
  'openai-vision-recognition': 'vision-recognition',
};
const pluginIconMonograms: Partial<Record<PluginIconName, string>> = {
  context7: 'C7',
};
const pluginIconBrandSources: Partial<Record<PluginIconName, string>> = {
  'openai-docs': openaiLogoUrl,
};
const pluginIconFileNames: Partial<Record<PluginIconName, string>> = {
  documents: 'document.docx',
  pdf: 'document.pdf',
};

/** Renders the same safe icon-token mapping in the marketplace and chat history. */
export function PluginIcon({
  className,
  name,
  pluginId,
  variant = 'card',
}: {
  className?: string;
  name?: string;
  pluginId?: string;
  variant?: PluginIconVariant;
}) {
  const icon = pluginIconName(name) ?? pluginIconName(pluginId) ?? pluginIconById[pluginId ?? ''] ?? null;
  const Glyph = icon ? pluginGlyphs[icon] : null;
  const monogram = icon ? pluginIconMonograms[icon] : pluginInitials(pluginId ?? name ?? 'Plugin');
  const brandSource = icon ? pluginIconBrandSources[icon] : undefined;
  const fileName = icon ? pluginIconFileNames[icon] : undefined;
  const fileIcon = fileName ? getIcon(fileName) : null;

  return (
    <span
      className={[
        'desktop-plugin-icon',
        `desktop-plugin-icon--${variant}`,
        className,
      ].filter(Boolean).join(' ')}
      data-plugin-icon={icon ?? 'plugin'}
      aria-hidden="true"
    >
      {fileIcon ? (
        <span
          className="desktop-plugin-icon__file-type"
          data-file-icon-theme="seti"
          data-file-icon-color={fileIcon.color}
          // 文件名来自上方静态映射，只用于选择内置 Seti 图标资源。
          dangerouslySetInnerHTML={{ __html: fileIcon.svg }}
        />
      ) : brandSource ? (
        <img alt="" className="desktop-plugin-icon__brand" draggable={false} src={brandSource} />
      ) : monogram ? (
        <span className={`desktop-plugin-icon__monogram${monogram.length > 1 ? ' desktop-plugin-icon__monogram--wide' : ''}`}>
          {monogram}
        </span>
      ) : Glyph ? <Glyph strokeWidth={2} /> : null}
    </span>
  );
}

function pluginIconName(value: string | undefined): PluginIconName | null {
  return value && knownPluginIcons.has(value) ? value as PluginIconName : null;
}

function pluginInitials(value: string): string {
  const words = value.split(/[^a-z0-9]+/iu).filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join('').toLocaleUpperCase();
  return (words[0] ?? 'P').slice(0, 2).toLocaleUpperCase();
}

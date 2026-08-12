import type { LucideIcon } from 'lucide-react';
import {
  BookOpenText,
  Braces,
  Compass,
  Eye,
  FilePenLine,
  FileSearch,
  FileText,
  FolderLock,
  FolderX,
  Globe2,
  ListTodo,
  ListX,
  MessageCircleQuestion,
  Puzzle,
  ScanSearch,
  ScrollText,
  ShieldAlert,
  Shrink,
  Sparkles,
} from 'lucide-react';

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

const pluginGlyphs: Record<PluginIconName, LucideIcon> = {
  context7: Braces,
  'openai-docs': BookOpenText,
  pdf: FileText,
  documents: FilePenLine,
  'image-generation': Sparkles,
  'vision-recognition': Eye,
  'web-search': Globe2,
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
  const Glyph = icon ? pluginGlyphs[icon] : Puzzle;

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
      <Glyph strokeWidth={1.75} />
    </span>
  );
}

function pluginIconName(value: string | undefined): PluginIconName | null {
  return value && knownPluginIcons.has(value) ? value as PluginIconName : null;
}

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
  'pi-question',
  'pi-todo',
  'pi-claude-rules',
] as const;

type PluginIconName = typeof pluginIconNames[number];

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
  'pi-question': MessageCircleQuestion,
  'pi-todo': ListTodo,
  'pi-claude-rules': ScrollText,
};

const knownPluginIcons = new Set<string>(pluginIconNames);

export function CapabilitiesPluginIcon({
  name,
  variant = 'card',
}: {
  name?: string;
  variant?: 'card' | 'detail' | 'inline' | 'installed' | 'list';
}) {
  const icon = name && knownPluginIcons.has(name) ? name as PluginIconName : null;
  const Glyph = icon ? pluginGlyphs[icon] : Puzzle;

  return (
    <span
      className={`desktop-plugin-icon desktop-plugin-icon--${variant}`}
      data-plugin-icon={icon ?? 'plugin'}
      aria-hidden="true"
    >
      <Glyph strokeWidth={1.75} />
    </span>
  );
}

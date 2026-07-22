import type { LucideIcon } from 'lucide-react';
import {
  BookOpenText,
  Braces,
  Compass,
  FilePenLine,
  FileSearch,
  FileText,
  FolderLock,
  FolderX,
  ListX,
  Puzzle,
  ScanSearch,
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
  'guard-dangerous-shell',
  'protect-secret-paths',
  'protect-generated-folders',
  'audit-file-mutations',
  'session-start-project-guidance',
  'prompt-secret-detector',
  'compact-warning',
  'stop-todo-continuation',
] as const;

type PluginIconName = typeof pluginIconNames[number];

const pluginGlyphs: Record<PluginIconName, LucideIcon> = {
  context7: Braces,
  'openai-docs': BookOpenText,
  pdf: FileText,
  documents: FilePenLine,
  'image-generation': Sparkles,
  'guard-dangerous-shell': ShieldAlert,
  'protect-secret-paths': FolderLock,
  'protect-generated-folders': FolderX,
  'audit-file-mutations': FileSearch,
  'session-start-project-guidance': Compass,
  'prompt-secret-detector': ScanSearch,
  'compact-warning': Shrink,
  'stop-todo-continuation': ListX,
};

const knownPluginIcons = new Set<string>(pluginIconNames);

export function CapabilitiesPluginIcon({
  name,
  variant = 'card',
}: {
  name?: string;
  variant?: 'card' | 'detail' | 'editorial' | 'inline' | 'list';
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

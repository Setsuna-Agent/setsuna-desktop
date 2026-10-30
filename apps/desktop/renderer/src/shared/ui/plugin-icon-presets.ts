import {
  AppWindow, BookOpenText, Braces, Eye, FileText,
  FolderLock, FolderX, Globe, ListTodo, Box, ScanSearch,
  ScrollText, ShieldAlert, Sparkles, type LucideIcon,
} from 'lucide-react';
import { ICON_PALETTE, type IconColor } from './icon-colors.js';

type PluginIconPreset = Readonly<{ Icon: LucideIcon; color: IconColor }>;

const pluginIconPresets = {
  'app-builder': { Icon: AppWindow, color: ICON_PALETTE.purple },
  'plugin-builder': { Icon: Box, color: ICON_PALETTE.purple },
  context7: { Icon: Braces, color: ICON_PALETTE.green },
  'openai-docs': { Icon: BookOpenText, color: 'text' },
  pdf: { Icon: FileText, color: ICON_PALETTE.red },
  documents: { Icon: FileText, color: ICON_PALETTE.blue },
  'image-generation': { Icon: Sparkles, color: ICON_PALETTE.purple },
  'vision-recognition': { Icon: Eye, color: ICON_PALETTE.blue },
  'web-search': { Icon: Globe, color: ICON_PALETTE.blue },
  'guard-dangerous-shell': { Icon: ShieldAlert, color: ICON_PALETTE.red },
  'protect-secret-paths': { Icon: FolderLock, color: ICON_PALETTE.yellow },
  'protect-generated-folders': { Icon: FolderX, color: ICON_PALETTE.blue },
  'prompt-secret-detector': { Icon: ScanSearch, color: ICON_PALETTE.pink },
  todo: { Icon: ListTodo, color: ICON_PALETTE.green },
  'claude-rules': { Icon: ScrollText, color: ICON_PALETTE.orange },
} as const satisfies Record<string, PluginIconPreset>;

type PluginIconName = keyof typeof pluginIconPresets;

const pluginIconById: Partial<Record<string, PluginIconName>> = {
  'context7-docs': 'context7',
  'openai-image-generation': 'image-generation',
  'openai-vision-recognition': 'vision-recognition',
};

const fallbackPluginIcon: PluginIconPreset = { Icon: Box, color: ICON_PALETTE.purple };

export function resolvePluginIconPreset(name?: string, pluginId?: string): PluginIconPreset {
  return findPreset(name) ?? findPreset(pluginId) ?? findPreset(pluginIconById[pluginId ?? '']) ?? fallbackPluginIcon;
}

function findPreset(value: string | undefined): PluginIconPreset | undefined {
  return value && Object.hasOwn(pluginIconPresets, value) ? pluginIconPresets[value as PluginIconName] : undefined;
}

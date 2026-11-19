import {
  Archive, BookOpen, BriefcaseBusiness, Building2, Calculator, CalendarDays, Camera,
  ChartColumn, ChartLine, ChartPie, ClipboardList, CodeXml, Coffee, CreditCard,
  Database, Dumbbell, FileCode2, FileSpreadsheet, FileText, FolderOpen, Globe2,
  GraduationCap, Headphones, House, Images, Languages, LayoutDashboard, ListChecks,
  Mail, Map, MessageSquare, Music2, Navigation, NotebookPen, Package, Plane, Box,
  Rocket, Search, ShieldCheck, ShoppingBag, SquareKanban, SquareTerminal, Table2,
  Target, Timer, Truck, Utensils,
  type LucideIcon,
} from 'lucide-react';
import type { IconColor } from '../icon-colors.js';

export type IconAvatarPreset = Readonly<{ key: string; Icon: LucideIcon }>;

/** App and plugin glyphs: keep this catalog independent from agent identity avatars. */
export const ICON_AVATAR_PRESETS = [
  { key: 'notebook', Icon: NotebookPen },
  { key: 'table', Icon: Table2 },
  { key: 'chart-column', Icon: ChartColumn },
  { key: 'chart-line', Icon: ChartLine },
  { key: 'chart-pie', Icon: ChartPie },
  { key: 'dashboard', Icon: LayoutDashboard },
  { key: 'clipboard', Icon: ClipboardList },
  { key: 'calendar', Icon: CalendarDays },
  { key: 'checklist', Icon: ListChecks },
  { key: 'kanban', Icon: SquareKanban },
  { key: 'timer', Icon: Timer },
  { key: 'target', Icon: Target },
  { key: 'folder', Icon: FolderOpen },
  { key: 'archive', Icon: Archive },
  { key: 'database', Icon: Database },
  { key: 'search', Icon: Search },
  { key: 'document', Icon: FileText },
  { key: 'spreadsheet', Icon: FileSpreadsheet },
  { key: 'file-code', Icon: FileCode2 },
  { key: 'code', Icon: CodeXml },
  { key: 'terminal', Icon: SquareTerminal },
  { key: 'globe', Icon: Globe2 },
  { key: 'map', Icon: Map },
  { key: 'navigation', Icon: Navigation },
  { key: 'camera', Icon: Camera },
  { key: 'images', Icon: Images },
  { key: 'music', Icon: Music2 },
  { key: 'headphones', Icon: Headphones },
  { key: 'book', Icon: BookOpen },
  { key: 'study', Icon: GraduationCap },
  { key: 'languages', Icon: Languages },
  { key: 'calculator', Icon: Calculator },
  { key: 'payment', Icon: CreditCard },
  { key: 'shopping', Icon: ShoppingBag },
  { key: 'package', Icon: Package },
  { key: 'truck', Icon: Truck },
  { key: 'plane', Icon: Plane },
  { key: 'fitness', Icon: Dumbbell },
  { key: 'food', Icon: Utensils },
  { key: 'coffee', Icon: Coffee },
  { key: 'house', Icon: House },
  { key: 'building', Icon: Building2 },
  { key: 'briefcase', Icon: BriefcaseBusiness },
  { key: 'mail', Icon: Mail },
  { key: 'message', Icon: MessageSquare },
  { key: 'rocket', Icon: Rocket },
  { key: 'puzzle', Icon: Box }, // Preserve saved avatar selections.
  { key: 'shield', Icon: ShieldCheck },
] as const satisfies readonly IconAvatarPreset[];

export type AvatarColor = IconColor;

export function isIconAvatarPresetKey(key: string): boolean {
  return ICON_AVATAR_PRESETS.some((preset) => preset.key === key);
}

export function randomAvatar() {
  const preset = ICON_AVATAR_PRESETS[Math.floor(Math.random() * ICON_AVATAR_PRESETS.length)] ?? ICON_AVATAR_PRESETS[0];
  return { type: 'preset' as const, key: preset.key };
}

/** Stable fallback while preferences initialize, including when storage is unavailable. */
export function fallbackAvatar(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return { type: 'preset' as const, key: (ICON_AVATAR_PRESETS[hash % ICON_AVATAR_PRESETS.length] ?? ICON_AVATAR_PRESETS[0]).key };
}

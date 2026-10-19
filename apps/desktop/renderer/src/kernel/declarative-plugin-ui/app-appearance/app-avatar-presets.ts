import {
  Archive, BookOpen, BriefcaseBusiness, Building2, Calculator, CalendarDays, Camera,
  ChartColumn, ChartLine, ChartPie, ClipboardList, CodeXml, Coffee, CreditCard,
  Database, Dumbbell, FileCode2, FileSpreadsheet, FileText, FolderOpen, Globe2,
  GraduationCap, Headphones, House, Images, Languages, LayoutDashboard, ListChecks,
  Mail, Map, MessageSquare, Music2, Navigation, NotebookPen, Package, Plane, Puzzle,
  Rocket, Search, ShieldCheck, ShoppingBag, SquareKanban, SquareTerminal, Table2,
  Target, Timer, Truck, Utensils,
  type LucideIcon,
} from 'lucide-react';
import { ICON_PALETTE, type IconColor } from '../../../shared/ui/icon-colors.js';

type AppAvatarPreset = Readonly<{ key: string; Icon: LucideIcon; color: IconColor }>;

/** App-specific glyphs: keep this catalog independent from agent identity avatars. */
export const APP_AVATAR_PRESETS = [
  { key: 'notebook', Icon: NotebookPen, color: ICON_PALETTE.blue },
  { key: 'table', Icon: Table2, color: ICON_PALETTE.green },
  { key: 'chart-column', Icon: ChartColumn, color: ICON_PALETTE.orange },
  { key: 'chart-line', Icon: ChartLine, color: ICON_PALETTE.purple },
  { key: 'chart-pie', Icon: ChartPie, color: ICON_PALETTE.pink },
  { key: 'dashboard', Icon: LayoutDashboard, color: ICON_PALETTE.purple },
  { key: 'clipboard', Icon: ClipboardList, color: ICON_PALETTE.blue },
  { key: 'calendar', Icon: CalendarDays, color: ICON_PALETTE.red },
  { key: 'checklist', Icon: ListChecks, color: ICON_PALETTE.green },
  { key: 'kanban', Icon: SquareKanban, color: ICON_PALETTE.blue },
  { key: 'timer', Icon: Timer, color: ICON_PALETTE.orange },
  { key: 'target', Icon: Target, color: ICON_PALETTE.red },
  { key: 'folder', Icon: FolderOpen, color: ICON_PALETTE.yellow },
  { key: 'archive', Icon: Archive, color: ICON_PALETTE.orange },
  { key: 'database', Icon: Database, color: ICON_PALETTE.purple },
  { key: 'search', Icon: Search, color: ICON_PALETTE.blue },
  { key: 'document', Icon: FileText, color: ICON_PALETTE.blue },
  { key: 'spreadsheet', Icon: FileSpreadsheet, color: ICON_PALETTE.green },
  { key: 'file-code', Icon: FileCode2, color: ICON_PALETTE.purple },
  { key: 'code', Icon: CodeXml, color: ICON_PALETTE.purple },
  { key: 'terminal', Icon: SquareTerminal, color: ICON_PALETTE.blue },
  { key: 'globe', Icon: Globe2, color: ICON_PALETTE.blue },
  { key: 'map', Icon: Map, color: ICON_PALETTE.green },
  { key: 'navigation', Icon: Navigation, color: ICON_PALETTE.blue },
  { key: 'camera', Icon: Camera, color: ICON_PALETTE.pink },
  { key: 'images', Icon: Images, color: ICON_PALETTE.purple },
  { key: 'music', Icon: Music2, color: ICON_PALETTE.red },
  { key: 'headphones', Icon: Headphones, color: ICON_PALETTE.purple },
  { key: 'book', Icon: BookOpen, color: ICON_PALETTE.green },
  { key: 'study', Icon: GraduationCap, color: ICON_PALETTE.blue },
  { key: 'languages', Icon: Languages, color: ICON_PALETTE.blue },
  { key: 'calculator', Icon: Calculator, color: ICON_PALETTE.orange },
  { key: 'payment', Icon: CreditCard, color: ICON_PALETTE.purple },
  { key: 'shopping', Icon: ShoppingBag, color: ICON_PALETTE.pink },
  { key: 'package', Icon: Package, color: ICON_PALETTE.orange },
  { key: 'truck', Icon: Truck, color: ICON_PALETTE.yellow },
  { key: 'plane', Icon: Plane, color: ICON_PALETTE.blue },
  { key: 'fitness', Icon: Dumbbell, color: ICON_PALETTE.green },
  { key: 'food', Icon: Utensils, color: ICON_PALETTE.red },
  { key: 'coffee', Icon: Coffee, color: ICON_PALETTE.orange },
  { key: 'house', Icon: House, color: ICON_PALETTE.green },
  { key: 'building', Icon: Building2, color: ICON_PALETTE.blue },
  { key: 'briefcase', Icon: BriefcaseBusiness, color: ICON_PALETTE.purple },
  { key: 'mail', Icon: Mail, color: ICON_PALETTE.blue },
  { key: 'message', Icon: MessageSquare, color: ICON_PALETTE.green },
  { key: 'rocket', Icon: Rocket, color: ICON_PALETTE.red },
  { key: 'puzzle', Icon: Puzzle, color: ICON_PALETTE.purple },
  { key: 'shield', Icon: ShieldCheck, color: ICON_PALETTE.green },
] as const satisfies readonly AppAvatarPreset[];

export type AppAvatarColor = IconColor;

export function isAppAvatarPresetKey(key: string): boolean {
  return APP_AVATAR_PRESETS.some((preset) => preset.key === key);
}

export function randomAppAvatar() {
  const preset = APP_AVATAR_PRESETS[Math.floor(Math.random() * APP_AVATAR_PRESETS.length)] ?? APP_AVATAR_PRESETS[0];
  return { type: 'preset' as const, key: preset.key };
}

/** Stable fallback while preferences initialize, including when storage is unavailable. */
export function fallbackAppAvatar(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return { type: 'preset' as const, key: (APP_AVATAR_PRESETS[hash % APP_AVATAR_PRESETS.length] ?? APP_AVATAR_PRESETS[0]).key };
}

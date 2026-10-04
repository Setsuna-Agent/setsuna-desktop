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

type AppAvatarPreset = Readonly<{ key: string; Icon: LucideIcon; color: string }>;

/** App-specific glyphs: keep this catalog independent from agent identity avatars. */
export const APP_AVATAR_PRESETS = [
  { key: 'notebook', Icon: NotebookPen, color: '#5688ed' },
  { key: 'table', Icon: Table2, color: '#31a183' },
  { key: 'chart-column', Icon: ChartColumn, color: '#cf8a2c' },
  { key: 'chart-line', Icon: ChartLine, color: '#ba71d5' },
  { key: 'chart-pie', Icon: ChartPie, color: '#df7087' },
  { key: 'dashboard', Icon: LayoutDashboard, color: '#6f80d6' },
  { key: 'clipboard', Icon: ClipboardList, color: '#3ca1b3' },
  { key: 'calendar', Icon: CalendarDays, color: '#d07760' },
  { key: 'checklist', Icon: ListChecks, color: '#31a183' },
  { key: 'kanban', Icon: SquareKanban, color: '#5688ed' },
  { key: 'timer', Icon: Timer, color: '#cf8a2c' },
  { key: 'target', Icon: Target, color: '#df7087' },
  { key: 'folder', Icon: FolderOpen, color: '#cf8a2c' },
  { key: 'archive', Icon: Archive, color: '#d07760' },
  { key: 'database', Icon: Database, color: '#6f80d6' },
  { key: 'search', Icon: Search, color: '#3ca1b3' },
  { key: 'document', Icon: FileText, color: '#5688ed' },
  { key: 'spreadsheet', Icon: FileSpreadsheet, color: '#31a183' },
  { key: 'file-code', Icon: FileCode2, color: '#ba71d5' },
  { key: 'code', Icon: CodeXml, color: '#6f80d6' },
  { key: 'terminal', Icon: SquareTerminal, color: '#3ca1b3' },
  { key: 'globe', Icon: Globe2, color: '#5688ed' },
  { key: 'map', Icon: Map, color: '#31a183' },
  { key: 'navigation', Icon: Navigation, color: '#6f80d6' },
  { key: 'camera', Icon: Camera, color: '#df7087' },
  { key: 'images', Icon: Images, color: '#ba71d5' },
  { key: 'music', Icon: Music2, color: '#d07760' },
  { key: 'headphones', Icon: Headphones, color: '#6f80d6' },
  { key: 'book', Icon: BookOpen, color: '#31a183' },
  { key: 'study', Icon: GraduationCap, color: '#5688ed' },
  { key: 'languages', Icon: Languages, color: '#3ca1b3' },
  { key: 'calculator', Icon: Calculator, color: '#cf8a2c' },
  { key: 'payment', Icon: CreditCard, color: '#ba71d5' },
  { key: 'shopping', Icon: ShoppingBag, color: '#df7087' },
  { key: 'package', Icon: Package, color: '#d07760' },
  { key: 'truck', Icon: Truck, color: '#cf8a2c' },
  { key: 'plane', Icon: Plane, color: '#5688ed' },
  { key: 'fitness', Icon: Dumbbell, color: '#31a183' },
  { key: 'food', Icon: Utensils, color: '#d07760' },
  { key: 'coffee', Icon: Coffee, color: '#cf8a2c' },
  { key: 'house', Icon: House, color: '#3ca1b3' },
  { key: 'building', Icon: Building2, color: '#6f80d6' },
  { key: 'briefcase', Icon: BriefcaseBusiness, color: '#ba71d5' },
  { key: 'mail', Icon: Mail, color: '#5688ed' },
  { key: 'message', Icon: MessageSquare, color: '#31a183' },
  { key: 'rocket', Icon: Rocket, color: '#df7087' },
  { key: 'puzzle', Icon: Puzzle, color: '#ba71d5' },
  { key: 'shield', Icon: ShieldCheck, color: '#3ca1b3' },
] as const satisfies readonly AppAvatarPreset[];

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

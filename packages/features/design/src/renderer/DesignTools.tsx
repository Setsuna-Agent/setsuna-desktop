import { ArrowUpRight, Check, ChevronDown, Circle, CodeXml, Frame, Globe, Hand, ImageIcon, LibraryBig, MousePointer2, Paintbrush, Pencil,
  Pentagon, PenTool, Shapes, Signature, Slash, Square, Star, Type, Variable, type LucideIcon } from 'lucide-react';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown, IconButton, Popover } from '@setsuna-desktop/renderer-ui';
import type { DesignTool } from './use-design-canvas-gestures.js';

const navigationTools = [
  { id: 'select', icon: MousePointer2, shortcut: 'V' },
  { id: 'hand', icon: Hand, shortcut: 'H' },
] as const;
const frame = { id: 'frame', icon: Frame, shortcut: 'F' } as const;
const shapeTools = [
  { id: 'rectangle', icon: Square, shortcut: 'R' },
  { id: 'line', icon: Slash, shortcut: 'L' },
  { id: 'arrow', icon: ArrowUpRight, shortcut: 'Shift+L' },
  { id: 'ellipse', icon: Circle, shortcut: 'O' },
  { id: 'polygon', icon: Pentagon, shortcut: 'G' },
  { id: 'star', icon: Star },
  { id: 'web', icon: Globe },
  { id: 'script', icon: CodeXml },
] as const;
const pen = { id: 'pen', icon: PenTool, shortcut: 'P' } as const;
const text = { id: 'text', icon: Type, shortcut: 'T' } as const;
const freehandTools = [
  { id: 'brush', icon: Paintbrush, shortcut: 'B' },
  { id: 'pencil', icon: Pencil, shortcut: 'N' },
] as const;
const designTools: readonly ToolDefinition[] = [...navigationTools, frame, ...shapeTools, pen, text];
const drawingTools: readonly ToolDefinition[] = [...designTools, ...freehandTools];

const imageShortcutKey = 'K';
const imagePanel = { id: 'image', icon: ImageIcon, label: 'feature.design.addImage', shortcut: `Shift+Mod+${imageShortcutKey}` } as const;
const panels = [
  { id: 'icon', icon: Shapes, label: 'feature.design.addIcon' },
  { id: 'variables', icon: Variable, label: 'feature.design.variables' },
  { id: 'library', icon: LibraryBig, label: 'feature.design.library' },
] as const;

type ToolPanelDefinition = typeof imagePanel | (typeof panels)[number];
export type DesignToolPanel = ToolPanelDefinition['id'];
export const designToolPopoverPosition = { placement: 'bottom', sideOffset: 8 } as const;
export type DesignToolPanels = Readonly<{
  active: DesignToolPanel | undefined;
  content: ReactNode;
  onOpenChange(id: DesignToolPanel, open: boolean): void;
}>;

type ToolDefinition = Readonly<{ id: DesignTool; icon: LucideIcon; shortcut?: string }>;
type ToolControls = Readonly<{
  tool: DesignTool;
  disabled: boolean;
  onChange(tool: DesignTool): void;
  translate: RendererTranslate;
}>;

export function designToolForKey({ key, shiftKey }: Pick<KeyboardEvent, 'key' | 'shiftKey'>, drawing = false): DesignTool | undefined {
  const tools = drawing ? drawingTools : designTools;
  const letter = key.toUpperCase();
  const chord = shiftKey ? `Shift+${letter}` : letter;
  return (tools.find(({ shortcut }) => shortcut === chord) ?? tools.find(({ shortcut }) => shortcut === letter))?.id;
}

export function isDesignImagePickerShortcut(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return event.shiftKey && (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toUpperCase() === imageShortcutKey;
}

export function DesignTools({ tool, disabled, drawingMode, onToggleDrawing, onChange, toolPanels, actions, translate: t }: ToolControls & Readonly<{
  drawingMode: boolean;
  onToggleDrawing(): void;
  toolPanels: DesignToolPanels;
  actions: ReactNode;
}>) {
  const controls = { tool, disabled, onChange, translate: t };
  const drawingLabel = t('feature.design.drawingMode');
  return <div className="design-tools" role="toolbar" aria-label={t('feature.design.tools')}>
    <IconButton size="small" label={drawingLabel} title={drawingLabel} aria-pressed={drawingMode} disabled={disabled} onClick={onToggleDrawing}>
      <Signature size={17} strokeWidth={1.8} />
    </IconButton>
    <span className="design-tools__divider" aria-hidden="true" />
    <ToolGroup {...controls} choices={navigationTools} label={t('feature.design.navigationTools')} />
    <span className="design-tools__divider" aria-hidden="true" />
    {drawingMode ? <>
      {[pen, ...freehandTools].map((item) => <ToolButton key={item.id} {...controls} item={item} />)}
      <span className="design-tools__divider" aria-hidden="true" />
    </> : null}
    <ToolButton {...controls} item={frame} />
    <ToolGroup {...controls} choices={shapeTools} label={t('feature.design.shapeTools')}
      panel={drawingMode ? undefined : { definition: imagePanel, state: toolPanels }} />
    {!drawingMode ? <ToolButton {...controls} item={pen} /> : null}
    <ToolButton {...controls} item={text} />
    <span className="design-tools__divider" aria-hidden="true" />
    {!drawingMode ? panels.map((panel) => <ToolPanelPopover key={panel.id} definition={panel} state={toolPanels} translate={t}>
      <IconButton size="small" label={t(panel.label)} disabled={disabled}><panel.icon size={17} strokeWidth={1.8} /></IconButton>
    </ToolPanelPopover>) : null}
    {!drawingMode ? <span className="design-tools__divider" aria-hidden="true" /> : null}
    {actions}
  </div>;
}

function ToolButton({ item: { id, icon: Icon, shortcut }, tool, disabled, onChange, translate: t }: ToolControls & Readonly<{ item: ToolDefinition }>) {
  const label = t(`feature.design.tool.${id}`);
  return <IconButton size="small" label={label} title={shortcut ? `${label} (${toolShortcutLabel(shortcut)})` : label}
    aria-pressed={tool === id} aria-keyshortcuts={shortcut} disabled={disabled} onClick={() => onChange(id)}>
    <Icon size={17} strokeWidth={1.8} />
  </IconButton>;
}

function ToolGroup({ choices, label, panel, ...controls }: ToolControls & Readonly<{
  choices: readonly [ToolDefinition, ...ToolDefinition[]];
  label: string;
  panel?: Readonly<{ definition: ToolPanelDefinition; state: DesignToolPanels }>;
}>) {
  const { tool, disabled, onChange, translate: t } = controls;
  const [last, setLast] = useState(choices[0]);
  const [menuOpen, setMenuOpen] = useState(false);
  const picked = useRef(false);
  const active = choices.find(({ id }) => tool === id);
  if (active && active !== last) setLast(active);
  const primary = active ?? last;
  const panelOpen = Boolean(panel && panel.state.active === panel.definition.id);

  const menu = <Dropdown open={menuOpen} disabled={disabled || panelOpen} placement="bottomRight"
    align={{ offset: [0, designToolPopoverPosition.sideOffset] }} rootClassName="sd-menu-surface--neutral"
    onOpenChange={(open) => {
      setMenuOpen(open);
      if (open) picked.current = false;
    }}
    onCloseAutoFocus={(event) => { if (picked.current) event.preventDefault(); }}
    menu={{ selectedKeys: [primary.id], onClick: () => { picked.current = true; }, items: [
      ...choices.map(({ id, icon: Icon, shortcut }) => ({
        key: id, label: t(`feature.design.tool.${id}`), disabled,
        icon: <ToolMenuIcon icon={Icon} selected={id === primary.id} />,
        extra: <ToolMenuShortcut shortcut={shortcut} />,
        onClick: () => onChange(id),
      })),
      panel ? {
        key: panel.definition.id, label: t(panel.definition.label), disabled,
        icon: <ToolMenuIcon icon={panel.definition.icon} />,
        extra: 'shortcut' in panel.definition ? <ToolMenuShortcut shortcut={panel.definition.shortcut} /> : undefined,
        onClick: () => panel.state.onOpenChange(panel.definition.id, true),
      } : null,
    ] }}>
    <IconButton className="design-tools__menu-trigger" size="small" label={label} disabled={disabled}
      aria-expanded={menuOpen || panelOpen} aria-haspopup={panelOpen ? 'dialog' : 'menu'}><ChevronDown size={12} /></IconButton>
  </Dropdown>;

  return <div className="design-tools__split">
    <ToolButton {...controls} item={primary} />
    {panel ? <ToolPanelPopover {...panel} fromMenu translate={t}>{menu}</ToolPanelPopover> : menu}
  </div>;
}

function toolShortcutLabel(shortcut: string): string {
  return /Mac/u.test(navigator.platform) ? shortcut.replace('Shift+', '⇧').replace('Mod+', '⌘') : shortcut.replace('Shift+Mod+', 'Ctrl+Shift+');
}

function ToolMenuIcon({ icon: Icon, selected }: Readonly<{ icon: LucideIcon; selected?: boolean }>) {
  return <span className="design-tools__menu-icon" aria-hidden="true">
    {selected ? <Check size={14} /> : null}
    <Icon size={15} />
  </span>;
}

function ToolMenuShortcut({ shortcut }: Readonly<{ shortcut?: string }>) {
  return shortcut ? <span className="sd-menu__extra design-tools__menu-shortcut" aria-hidden="true">{toolShortcutLabel(shortcut)}</span> : null;
}

function ToolPanelPopover({ definition: { id, label }, state, fromMenu, translate: t, children }: Readonly<{
  definition: ToolPanelDefinition;
  state: DesignToolPanels;
  fromMenu?: boolean;
  translate: RendererTranslate;
  children: ReactElement;
}>) {
  const open = state.active === id;
  return <Popover {...designToolPopoverPosition} open={open}
    onOpenChange={(next) => {
      // The shared trigger opens the menu first. Only selecting its item opens the panel.
      if (!next || !fromMenu) state.onOpenChange(id, next);
    }}
    onCloseAutoFocus={(event) => {
      // Keep focus in the newly opened panel when switching tools.
      if (state.active && state.active !== id) event.preventDefault();
    }}
    className={`design-tool-popover design-tool-popover--${id}`} contentLabel={t(label)}
    content={open ? <div className="design-tool-popover__content">{state.content}</div> : null}>
    {children}
  </Popover>;
}

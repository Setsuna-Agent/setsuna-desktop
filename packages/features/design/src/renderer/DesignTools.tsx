import { ArrowUpRight, Check, ChevronDown, Circle, CodeXml, Copy, Ellipsis, Frame, Globe, Group, Hand, ImageIcon, LibraryBig, ListChecks,
  MousePointer2, Paintbrush, Pencil, Pentagon, PenTool, Shapes, Signature, Slash, Square, Star, Trash2, Type, Ungroup, Variable, type LucideIcon } from 'lucide-react';
import { useRef, useState, type ReactElement, type ReactNode, type Ref, type WheelEvent } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown, IconButton } from '@setsuna-desktop/renderer-ui';
import { DesignToolWindow } from './canvas/DesignToolWindow.js';
import type { DesignToolbarPosition } from './context/design-canvas-settings.js';
import type { DesignShortcuts } from './settings/design-shortcuts.js';
import type { DesignTool } from './use-design-canvas-gestures.js';

const navigationTools = [
  { id: 'select', icon: MousePointer2 },
  { id: 'hand', icon: Hand },
] as const;
const frame = { id: 'frame', icon: Frame } as const;
const shapeTools = [
  { id: 'rectangle', icon: Square },
  { id: 'line', icon: Slash },
  { id: 'arrow', icon: ArrowUpRight },
  { id: 'ellipse', icon: Circle },
  { id: 'polygon', icon: Pentagon },
  { id: 'star', icon: Star },
  { id: 'web', icon: Globe },
  { id: 'script', icon: CodeXml },
] as const;
const pen = { id: 'pen', icon: PenTool } as const;
const text = { id: 'text', icon: Type } as const;
const freehandTools = [
  { id: 'brush', icon: Paintbrush },
  { id: 'pencil', icon: Pencil },
] as const;
const imagePanel = { id: 'image', icon: ImageIcon, label: 'feature.design.addImage' } as const;
const panels = [
  { id: 'icon', icon: Shapes, label: 'feature.design.addIcon' },
  { id: 'variables', icon: Variable, label: 'feature.design.variables' },
  { id: 'library', icon: LibraryBig, label: 'feature.design.library' },
  { id: 'audit', icon: ListChecks, label: 'feature.design.audit' },
] as const;

type ToolPanelDefinition = typeof imagePanel | (typeof panels)[number];
export type DesignToolPanel = ToolPanelDefinition['id'];
const placements = { side: 'rightTop', top: 'bottomLeft', bottom: 'topLeft' } as const;
export function designToolPopoverPosition(position: DesignToolbarPosition) {
  return { placement: placements[position], sideOffset: 8 } as const;
}
export type DesignToolPanels = Readonly<{
  active: DesignToolPanel | undefined;
  content: ReactNode;
  onOpenChange(id: DesignToolPanel, open: boolean): void;
}>;
export type DesignToolSelectionActions = Readonly<{
  group?: () => void;
  ungroup?: () => void;
  duplicate(): void;
  delete?: () => void;
}>;

type ToolDefinition = Readonly<{ id: DesignTool; icon: LucideIcon }>;
type ToolControls = Readonly<{
  tool: DesignTool;
  disabled: boolean;
  shortcuts: DesignShortcuts;
  onChange(tool: DesignTool): void;
  translate: RendererTranslate;
}>;

export function scrollDesignToolbar(event: WheelEvent<HTMLDivElement>) {
  const { currentTarget, target } = event;
  if (target instanceof Node && currentTarget.contains(target)
    && !event.deltaX && !event.shiftKey && !event.ctrlKey && !event.metaKey) currentTarget.scrollLeft += event.deltaY;
}

export function DesignTools({ toolbarRef, tool, disabled, navigationDisabled, drawingMode, onToggleDrawing, onChange, toolPanels, selectionActions, position, shortcuts, translate: t }: ToolControls & Readonly<{
  toolbarRef?: Ref<HTMLDivElement>;
  drawingMode: boolean;
  navigationDisabled: boolean;
  onToggleDrawing(): void;
  toolPanels: DesignToolPanels;
  selectionActions?: DesignToolSelectionActions;
  position: DesignToolbarPosition;
}>) {
  const controls = { tool, disabled, onChange, shortcuts, translate: t };
  const anchor = designToolPopoverPosition(position);
  const drawingLabel = t('feature.design.drawingMode');
  return <div ref={toolbarRef} className="design-tools" role="toolbar" aria-orientation={position === 'side' ? 'vertical' : 'horizontal'} aria-label={t('feature.design.tools')}
    onWheel={position === 'side' ? undefined : scrollDesignToolbar}>
    <ToolGroup {...controls} disabled={navigationDisabled} choices={navigationTools} anchor={anchor} label={t('feature.design.navigationTools')} />
    <ToolGroup {...controls} choices={shapeTools} anchor={anchor} label={t('feature.design.shapeTools')}
      panel={drawingMode ? undefined : { definition: imagePanel, state: toolPanels }} />
    <IconButton className="design-tools__drawing-toggle" size="small" label={drawingLabel} title={drawingLabel}
      aria-pressed={drawingMode} disabled={disabled} onClick={onToggleDrawing}>
      <Signature size={17} strokeWidth={1.8} />
    </IconButton>
    {drawingMode ? [pen, ...freehandTools].map((item) => <ToolButton key={item.id} {...controls} item={item} />) : null}
    <ToolButton {...controls} item={frame} />
    {!drawingMode ? <ToolButton {...controls} item={pen} /> : null}
    <ToolButton {...controls} item={text} />
    {!drawingMode ? panels.map((panel) => <ToolPanelPopover key={panel.id} definition={panel} state={toolPanels} anchor={anchor} translate={t}>
      <IconButton size="small" label={t(panel.label)} disabled={panel.id === 'audit' ? navigationDisabled : disabled}><panel.icon size={17} strokeWidth={1.8} /></IconButton>
    </ToolPanelPopover>) : null}
    {selectionActions ? <Dropdown placement={anchor.placement} disabled={disabled}
      align={{ offset: [0, anchor.sideOffset] }} menu={{ items: [
        selectionActions.ungroup || selectionActions.group ? {
          key: 'group', label: t(selectionActions.ungroup ? 'feature.design.ungroup' : 'feature.design.groupSelection'),
          icon: selectionActions.ungroup ? <Ungroup size={15} /> : <Group size={15} />,
          onClick: selectionActions.ungroup ?? selectionActions.group, disabled,
        } : null,
        { key: 'duplicate', label: t('feature.design.duplicate'), icon: <Copy size={15} />, disabled, onClick: selectionActions.duplicate },
        { key: 'delete', label: t('feature.design.delete'), icon: <Trash2 size={15} />, danger: true, disabled, onClick: selectionActions.delete },
      ] }}>
      <IconButton label={t('feature.design.layerActions')} size="small" disabled={disabled}><Ellipsis size={17} /></IconButton>
    </Dropdown> : null}
  </div>;
}

function ToolButton({ item: { id, icon: Icon }, tool, disabled, onChange, shortcuts, translate: t }: ToolControls & Readonly<{ item: ToolDefinition }>) {
  const label = t(`feature.design.tool.${id}`);
  return <IconButton size="small" label={label} title={designShortcutTitle(label, shortcuts.label(`tool.${id}`))}
    aria-pressed={tool === id} aria-keyshortcuts={shortcuts.ariaBindings(`tool.${id}`)} disabled={disabled} onClick={() => onChange(id)}>
    <Icon size={17} strokeWidth={1.8} />
  </IconButton>;
}

function ToolGroup({ choices, label, panel, anchor, ...controls }: ToolControls & Readonly<{
  choices: readonly [ToolDefinition, ...ToolDefinition[]];
  label: string;
  panel?: Readonly<{ definition: ToolPanelDefinition; state: DesignToolPanels }>;
  anchor: ReturnType<typeof designToolPopoverPosition>;
}>) {
  const { tool, disabled, onChange, shortcuts, translate: t } = controls;
  const [last, setLast] = useState(choices[0]);
  const [menuOpen, setMenuOpen] = useState(false);
  const picked = useRef(false);
  const active = choices.find(({ id }) => tool === id);
  if (active && active !== last) setLast(active);
  const primary = active ?? last;
  const panelOpen = Boolean(panel && panel.state.active === panel.definition.id);

  const menu = <Dropdown open={menuOpen} disabled={disabled || panelOpen} placement={anchor.placement}
    align={{ offset: [0, anchor.sideOffset] }} rootClassName="sd-menu-surface--neutral"
    onOpenChange={(open) => {
      setMenuOpen(open);
      if (open) picked.current = false;
    }}
    onCloseAutoFocus={(event) => { if (picked.current) event.preventDefault(); }}
    menu={{ selectedKeys: [primary.id], onClick: () => { picked.current = true; }, items: [
      ...choices.map(({ id, icon: Icon }) => ({
        key: id, label: t(`feature.design.tool.${id}`), disabled,
        icon: <ToolMenuIcon icon={Icon} selected={id === primary.id} />,
        extra: <ToolMenuShortcut shortcut={shortcuts.label(`tool.${id}`)} />,
        onClick: () => onChange(id),
      })),
      panel ? {
        key: panel.definition.id, label: t(panel.definition.label), disabled,
        icon: <ToolMenuIcon icon={panel.definition.icon} />,
        extra: <ToolMenuShortcut shortcut={shortcuts.label(panel.definition.id)} />,
        onClick: () => panel.state.onOpenChange(panel.definition.id, true),
      } : null,
    ] }}>
    <IconButton className="design-tools__menu-trigger" size="small" label={label} disabled={disabled}
      aria-expanded={menuOpen || panelOpen} aria-haspopup={panelOpen ? 'dialog' : 'menu'}><ChevronDown size={12} /></IconButton>
  </Dropdown>;

  return <div className="design-tools__split">
    <ToolButton {...controls} item={primary} />
    {panel ? <ToolPanelPopover {...panel} fromMenu anchor={anchor} translate={t}>{menu}</ToolPanelPopover> : menu}
  </div>;
}

export function designShortcutTitle(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${shortcut})` : label;
}

function ToolMenuIcon({ icon: Icon, selected }: Readonly<{ icon: LucideIcon; selected?: boolean }>) {
  return <span className="design-tools__menu-icon" aria-hidden="true">
    {selected ? <Check size={14} /> : null}
    <Icon size={15} />
  </span>;
}

function ToolMenuShortcut({ shortcut }: Readonly<{ shortcut?: string }>) {
  return shortcut ? <span className="sd-menu__extra design-tools__menu-shortcut" aria-hidden="true">{shortcut}</span> : null;
}

function ToolPanelPopover({ definition: { id, label }, state, fromMenu, anchor, translate: t, children }: Readonly<{
  definition: ToolPanelDefinition;
  state: DesignToolPanels;
  fromMenu?: boolean;
  anchor: ReturnType<typeof designToolPopoverPosition>;
  translate: RendererTranslate;
  children: ReactElement;
}>) {
  const open = state.active === id;
  return <DesignToolWindow {...anchor} kind={id} open={open} translate={t}
    onOpenChange={(next) => {
      // The shared trigger opens the menu first. Only selecting its item opens the panel.
      if (!next || !fromMenu) state.onOpenChange(id, next);
    }}
    onCloseAutoFocus={(event) => {
      // Keep focus in the newly opened panel when switching tools.
      if (state.active && state.active !== id) event.preventDefault();
    }}
    contentLabel={t(label)} content={state.content}>
    {children}
  </DesignToolWindow>;
}

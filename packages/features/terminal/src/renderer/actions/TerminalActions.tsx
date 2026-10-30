import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Dropdown, IconButton, useToast } from '@setsuna-desktop/renderer-ui';
import { Ellipsis, Plus, Settings, SquareTerminal } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { TerminalActionDialog } from './TerminalActionDialog.js';
import { TerminalActionIcon } from './TerminalActionIcon.js';
import { useTerminalActionsHost, type TerminalActionProject } from './context.js';
import { useTerminalActions } from './useTerminalActions.js';
import { useTerminalActionMenuPosition } from './useTerminalActionMenuPosition.js';
import './actions.css';

export function TerminalActions({ project, translate: t, menuAnchorRef }: {
  project: TerminalActionProject;
  translate: RendererTranslate;
  menuAnchorRef?: RefObject<HTMLElement>;
}) {
  const host = useTerminalActionsHost();
  const actions = useTerminalActions(project.id, t);
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPosition = useTerminalActionMenuPosition(menuAnchorRef, menuOpen);
  const [running, setRunning] = useState(false);
  const launching = useRef(false);
  const available = actions.actions.filter((action) => action.platform === 'all' || action.platform === host?.platform);
  const selected = available.find((action) => action.id === actions.selected?.id) ?? available[0] ?? null;
  const run = async () => {
    if (!selected || !host?.runAction || launching.current) return;
    launching.current = true;
    setRunning(true);
    try { await host.runAction(selected); }
    catch { toast.error(t('feature.terminal.actions.runFailed')); }
    finally { launching.current = false; setRunning(false); }
  };

  return <div className="feature-terminal-actions">
    <Dropdown ref={menuPosition.triggerRef} placement={menuPosition.placement} align={menuPosition.align}
      open={menuOpen} onOpenChange={setMenuOpen}
      className="feature-terminal-actions-menu"
      onCloseAutoFocus={(event) => { if (adding) event.preventDefault(); }}
      menu={{ selectedKeys: selected ? [selected.id] : [], items: [
        { type: 'group', label: t('feature.terminal.actions.title'), children: [
          ...available.map((action) => ({ key: action.id, label: action.name, icon: <TerminalActionIcon icon={action.icon} size={14} />,
            onClick: () => { actions.select(action.id); } })),
          { key: 'add', label: t('feature.terminal.actions.add'), icon: <Plus size={14} />, disabled: !actions.ready,
            onClick: () => setAdding(true) },
        ] },
        { type: 'divider' },
        { key: 'settings', label: t('feature.terminal.actions.environmentSettings'), icon: <Settings size={14} />, disabled: !host,
          onClick: () => host?.openProjectSettings(project) },
        { key: 'terminal', label: t('feature.terminal.actions.openTerminal'), icon: <SquareTerminal size={14} />, disabled: !host?.openTerminal,
          onClick: () => host?.openTerminal?.() },
      ] }}>
      <IconButton label={t('feature.terminal.actions.title')}><Ellipsis size={15} /></IconButton>
    </Dropdown>
    {selected ? <IconButton label={t('feature.terminal.actions.run', { name: selected.name })}
      disabled={!host?.runAction || running} onClick={() => { void run(); }}>
      <TerminalActionIcon icon={selected.icon} size={15} />
    </IconButton> : null}
    {adding ? <TerminalActionDialog mode="quick" translate={t} onSave={actions.add} onClose={() => setAdding(false)}
      onOpenSettings={(draft) => host?.openProjectSettings(project, draft)} /> : null}
  </div>;
}

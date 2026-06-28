import { PanelRight, Terminal } from 'lucide-react';
import { IconButton } from '../primitives.js';
import type { MainView } from '../../types/app.js';

export function AppTopbarActions({
  hasProject,
  activeView,
  bottomTerminalPanelOpen,
  sidePanelVisible,
  onToggleSidePanel,
  onToggleBottomTerminal,
}: {
  hasProject: boolean;
  activeView: MainView;
  bottomTerminalPanelOpen: boolean;
  sidePanelVisible: boolean;
  onToggleSidePanel: () => void;
  onToggleBottomTerminal: () => void;
}) {
  return (
    <>
      {activeView === 'chat' && !sidePanelVisible ? (
        <IconButton
          label={bottomTerminalPanelOpen ? '关闭终端' : '打开终端'}
          className={bottomTerminalPanelOpen ? 'is-active' : ''}
          onClick={onToggleBottomTerminal}
        >
          <Terminal size={16} />
        </IconButton>
      ) : null}
      {activeView === 'chat' && hasProject && !sidePanelVisible ? (
        <IconButton label="打开右侧栏" onClick={onToggleSidePanel}>
          <PanelRight size={16} />
        </IconButton>
      ) : null}
    </>
  );
}

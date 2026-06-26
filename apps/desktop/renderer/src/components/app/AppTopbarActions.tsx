import { PanelRight, Terminal } from 'lucide-react';
import { IconButton } from '../primitives.js';
import type { MainView } from '../../types/app.js';

export function AppTopbarActions({
  hasProject,
  activeView,
  bottomTerminalPanelOpen,
  sidePanelVisible,
  reviewPanelOpen,
  onOpenReviewPanel,
  onToggleBottomTerminal,
}: {
  hasProject: boolean;
  activeView: MainView;
  bottomTerminalPanelOpen: boolean;
  sidePanelVisible: boolean;
  reviewPanelOpen: boolean;
  onOpenReviewPanel: () => void;
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
        <IconButton label={reviewPanelOpen ? '收起审查面板' : '展开审查面板'} className={reviewPanelOpen ? 'is-active' : ''} onClick={onOpenReviewPanel}>
          <PanelRight size={16} />
        </IconButton>
      ) : null}
    </>
  );
}

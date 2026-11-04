import { IconSwap } from '@setsuna-desktop/renderer-ui';
import { ArrowUp, Square } from 'lucide-react';

/** 发送与停止共用同一图标位；所在按钮节点被复用时，状态切换会交叉淡入。 */
export function ChatSubmitIcon({ stop }: { stop: boolean }) {
  return (
    <IconSwap swapKey={stop ? 'stop' : 'send'}>
      {stop ? <Square size={13} fill="currentColor" /> : <ArrowUp size={16} />}
    </IconSwap>
  );
}

import { IconSwap } from '@setsuna-desktop/renderer-ui';
import { ArrowUp, Square } from 'lucide-react';

/** 发送与停止共用同一图标位；所在按钮节点被复用时，状态切换会交叉淡入。 */
export function ChatSubmitIcon({ stop }: { stop: boolean }) {
  // 偶数尺寸避免 SVG 画布在 28px 按钮内因半像素取整而偏心。
  return (
    <IconSwap swapKey={stop ? 'stop' : 'send'}>
      {stop ? <Square size={14} fill="currentColor" /> : <ArrowUp size={16} />}
    </IconSwap>
  );
}

import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useState } from 'react';
import { hasRealModelConfigured } from '../chatModelAvailability.js';

const MODEL_SETUP_NOTICE_STORAGE_KEY = 'setsuna.chat.modelSetupNoticeDismissed';

/**
 * 首屏“尚未配置模型服务”引导的显隐状态。
 * 忽略标记只在未配置期间生效：一旦配置了真实模型就清除标记，
 * 之后用户若再删光 provider，引导会重新出现。
 */
export function useModelSetupNotice(config: RuntimeConfigState | null) {
  const [dismissed, setDismissed] = useState(readModelSetupNoticeDismissed);

  useEffect(() => {
    if (!hasRealModelConfigured(config)) return;
    clearModelSetupNoticeDismissal();
    setDismissed(false);
  }, [config]);

  const dismissModelSetupNotice = useCallback(() => {
    rememberModelSetupNoticeDismissal();
    setDismissed(true);
  }, []);

  const modelSetupNoticeVisible = Boolean(config) && !dismissed && !hasRealModelConfigured(config);
  return { modelSetupNoticeVisible, dismissModelSetupNotice };
}

function readModelSetupNoticeDismissed(): boolean {
  try {
    return window.localStorage.getItem(MODEL_SETUP_NOTICE_STORAGE_KEY) === '1';
  } catch {
    // 受限渲染环境可能无法访问 localStorage，此时按未忽略处理。
    return false;
  }
}

function rememberModelSetupNoticeDismissal(): void {
  try {
    window.localStorage.setItem(MODEL_SETUP_NOTICE_STORAGE_KEY, '1');
  } catch {
    // 忽略持久化失败，组件内状态仍可保证当次会话不再展示。
  }
}

function clearModelSetupNoticeDismissal(): void {
  try {
    window.localStorage.removeItem(MODEL_SETUP_NOTICE_STORAGE_KEY);
  } catch {
    // 同上，清除失败只影响下次启动时的引导重现。
  }
}

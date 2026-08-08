import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useState } from 'react';
import {
  readBrowserStorageValue,
  removeBrowserStorageValue,
  writeBrowserStorageValue,
} from '../../../shared/preferences/browserStorage.js';
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
  return readBrowserStorageValue(MODEL_SETUP_NOTICE_STORAGE_KEY) === '1';
}

function rememberModelSetupNoticeDismissal(): void {
  writeBrowserStorageValue(MODEL_SETUP_NOTICE_STORAGE_KEY, '1');
}

function clearModelSetupNoticeDismissal(): void {
  removeBrowserStorageValue(MODEL_SETUP_NOTICE_STORAGE_KEY);
}

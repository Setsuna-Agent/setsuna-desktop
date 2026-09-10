import { createContext, useContext, type ReactNode } from 'react';

const labels = {
  'zh-CN': { close: '关闭', cancel: '取消', confirm: '确认', preview: '预览图片', previous: '上一张图片', next: '下一张图片', zoomIn: '放大', zoomOut: '缩小', rotate: '旋转图片' },
  'en-US': { close: 'Close', cancel: 'Cancel', confirm: 'Confirm', preview: 'Preview image', previous: 'Previous image', next: 'Next image', zoomIn: 'Zoom in', zoomOut: 'Zoom out', rotate: 'Rotate image' },
};
const UiLocaleContext = createContext(labels['zh-CN']);

export function UiProvider({ locale, children }: { locale: keyof typeof labels; children: ReactNode }) {
  return <UiLocaleContext.Provider value={labels[locale]}>{children}</UiLocaleContext.Provider>;
}
export function useUiLabels() { return useContext(UiLocaleContext); }

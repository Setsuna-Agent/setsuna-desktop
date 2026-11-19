import { createContext, useContext, type ReactNode } from 'react';

const labels = {
  'zh-CN': {
    close: '关闭', cancel: '取消', confirm: '确认', notifications: '通知', preview: '预览图片', previous: '上一张图片', next: '下一张图片', zoomIn: '放大', zoomOut: '缩小', rotate: '旋转图片',
    colorPicker: { area: '饱和度与亮度', saturation: '饱和度', brightness: '亮度', hue: '色相', opacity: '不透明度', format: '颜色格式',
      sample: '从屏幕取色', sampleError: '无法从屏幕取色' },
  },
  'en-US': {
    close: 'Close', cancel: 'Cancel', confirm: 'Confirm', notifications: 'Notifications', preview: 'Preview image', previous: 'Previous image', next: 'Next image', zoomIn: 'Zoom in', zoomOut: 'Zoom out', rotate: 'Rotate image',
    colorPicker: { area: 'Saturation and brightness', saturation: 'Saturation', brightness: 'Brightness', hue: 'Hue', opacity: 'Opacity', format: 'Color format',
      sample: 'Pick a color from the screen', sampleError: 'Could not pick a color from the screen' },
  },
};
const UiLocaleContext = createContext(labels['zh-CN']);

export function UiProvider({ locale, children }: { locale: keyof typeof labels; children: ReactNode }) {
  return <UiLocaleContext.Provider value={labels[locale]}>{children}</UiLocaleContext.Provider>;
}
export function useUiLabels() { return useContext(UiLocaleContext); }

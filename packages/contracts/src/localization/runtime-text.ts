import type { RuntimeInterfaceLanguage } from '../config.js';

/** 内置模型提示文案就地维护中英文；每次请求选择语言，避免全局状态串扰。 */
export function runtimeText(language: RuntimeInterfaceLanguage = 'en-US') {
  return (english: string, chinese: string): string => language === 'zh-CN' ? chinese : english;
}

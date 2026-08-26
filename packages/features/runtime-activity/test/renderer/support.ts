import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { runtimeActivityMessages } from '../../src/renderer/messages.js';

export const runtimeActivityTestTranslate: RendererTranslate = (key, params) => {
  const template = runtimeActivityMessages.messages['zh-CN']?.[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => String(params[name] ?? match));
};

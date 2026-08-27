import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  inferRuntimeResponseLanguage,
  resolveRuntimeResponseLanguage,
  runtimeResponseLanguagePrompt,
} from '../../../src/loop/context/runtime-response-language.js';

describe('runtime response language', () => {
  it.each([
    ['帮我检查一下最新的 `git commit`', 'zh-CN'],
    ['Explain what the “中文” label means', 'en-US'],
    ['Please answer in Chinese', 'zh-CN'],
    ['请用英文回答这个问题', 'en-US'],
  ] as const)('infers %s as %s', (content, expected) => {
    expect(inferRuntimeResponseLanguage(content)).toBe(expected);
  });

  it('preserves the established user language when the current input is not substantive', () => {
    const conversationMessages: RuntimeMessage[] = [{
      id: 'msg_user',
      role: 'user',
      content: '请继续处理这个问题',
      createdAt: '2026-08-27T00:00:00.000Z',
      status: 'complete',
    }];

    expect(resolveRuntimeResponseLanguage({
      currentUserContent: '123',
      conversationMessages,
      fallback: 'en-US',
    })).toBe('zh-CN');
  });

  it('states the response constraint in the target language', () => {
    expect(runtimeResponseLanguagePrompt('zh-CN')).toMatch(/^本轮回答的目标语言是简体中文。/u);
    expect(runtimeResponseLanguagePrompt('en-US')).toMatch(/^The target response language for this turn is English\./u);
  });
});

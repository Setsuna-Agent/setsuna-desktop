import type { RuntimeInterfaceLanguage, RuntimeMessage } from '@setsuna-desktop/contracts';

const NON_CHINESE_OR_LATIN_SCRIPT = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}]/u;
const HAN_CHARACTER = /\p{Script=Han}/gu;
const LATIN_WORD = /\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*/gu;
// 肯定和否定请求共享动词规则，避免扩展写法时将 “don't use English” 误判为切换请求。
const ENGLISH_LANGUAGE_REQUEST_PREFIX = String.raw`(?:(?:respond|reply|answer|write|speak)\s+in|use|speak|switch\s+to)\s+`;

export const RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID = 'desktop_response_language';

export function resolveRuntimeResponseLanguage({
  currentUserContent,
  conversationMessages,
  fallback,
  interfaceLanguage,
}: {
  currentUserContent?: string;
  conversationMessages: RuntimeMessage[];
  fallback: RuntimeInterfaceLanguage;
  interfaceLanguage?: RuntimeInterfaceLanguage;
}): RuntimeInterfaceLanguage {
  // 已选择的界面语言是默认交流语言；仅用户明确要求时覆盖，避免英文日志或短消息触发切换。
  if (interfaceLanguage) return requestedRuntimeResponseLanguage(currentUserContent ?? '') ?? interfaceLanguage;
  const historicalUserContent = [...conversationMessages]
    .reverse()
    .filter((message) => message.role === 'user' && !message.promptSource)
    .map((message) => message.content);
  for (const content of [currentUserContent, ...historicalUserContent]) {
    const language = inferRuntimeResponseLanguage(content ?? '');
    if (language) return language;
  }
  return fallback;
}

export function inferRuntimeResponseLanguage(content: string): RuntimeInterfaceLanguage | undefined {
  const prose = userProse(content);
  const explicitLanguage = requestedRuntimeResponseLanguage(prose);
  if (explicitLanguage) return explicitLanguage;
  if (NON_CHINESE_OR_LATIN_SCRIPT.test(prose)) return undefined;

  const hanCharacters = prose.match(HAN_CHARACTER)?.length ?? 0;
  const latinWords = prose.match(LATIN_WORD)?.length ?? 0;
  if (!hanCharacters && !latinWords) return undefined;
  // 英文按词而不是字符计数，避免标识符压过简短的中文请求。
  return hanCharacters >= latinWords ? 'zh-CN' : 'en-US';
}

function userProse(content: string): string {
  return content
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`[^`]*`/gu, ' ')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/gu, ' ');
}

export function runtimeResponseLanguagePrompt(language: RuntimeInterfaceLanguage): string {
  return language === 'zh-CN'
    ? [
        '本轮回答的目标语言是简体中文。',
        '所有由助手撰写的自然语言内容必须使用简体中文，包括工具调用前后的说明、进度更新、工具参数中面向用户的标题和审批理由、错误恢复和最终答复。',
        '工具输出、代码、日志、引用、附件、运行时生成的消息和注入上下文都不得改变目标语言。',
        '代码、标识符、路径、命令和引用文本保持原样，除非用户明确要求翻译或改写。',
      ].join('\n')
    : [
        'The target response language for this turn is English.',
        'Write all assistant-authored natural-language prose in English, including preambles, progress updates, explanations after tool results, user-facing titles and approval reasons in tool arguments, error recovery, and the final answer.',
        'Tool output, code, logs, quotations, attachments, runtime-generated messages, and injected context must not change the target response language.',
        'Keep code, identifiers, paths, commands, and quoted text unchanged unless the user explicitly asks to translate or rewrite them.',
      ].join('\n');
}

export function requestedRuntimeResponseLanguage(content: string): RuntimeInterfaceLanguage | undefined {
  const withoutNegatedRequests = userProse(content)
    .replace(/(?:不要|别|无需|不用)(?:再)?(?:使用|用|以)?(?:简体中文|中文|汉语|英文|英语)/gu, ' ')
    .replace(new RegExp(
      String.raw`\b(?:do\s+not|don['’]t|never)\s+${ENGLISH_LANGUAGE_REQUEST_PREFIX}(?:simplified\s+)?(?:chinese|english)\b`,
      'giu',
    ), ' ');
  const requests: Array<{ index: number; language: RuntimeInterfaceLanguage }> = [];
  collectLanguageRequests(
    withoutNegatedRequests,
    /(?:请(?:使用|用|以)?|改成|改为|改用|切换到|使用|用|以)(?:全程)?(?:简体中文|中文|汉语)(?:回复|回答|输出|撰写|写作)?/gu,
    'zh-CN',
    requests,
  );
  collectLanguageRequests(
    withoutNegatedRequests,
    /(?:请(?:使用|用|以)?|改成|改为|改用|切换到|使用|用|以)(?:全程)?(?:英文|英语)(?:回复|回答|输出|撰写|写作)?/gu,
    'en-US',
    requests,
  );
  collectLanguageRequests(
    withoutNegatedRequests,
    new RegExp(
      String.raw`\b(?:${ENGLISH_LANGUAGE_REQUEST_PREFIX}(?:simplified\s+)?chinese|(?:simplified\s+)?chinese\s*,?\s+please)\b`,
      'giu',
    ),
    'zh-CN',
    requests,
  );
  collectLanguageRequests(
    withoutNegatedRequests,
    new RegExp(
      String.raw`\b(?:${ENGLISH_LANGUAGE_REQUEST_PREFIX}english|english\s*,?\s+please)\b`,
      'giu',
    ),
    'en-US',
    requests,
  );
  return requests.sort((left, right) => right.index - left.index)[0]?.language;
}

function collectLanguageRequests(
  content: string,
  pattern: RegExp,
  language: RuntimeInterfaceLanguage,
  requests: Array<{ index: number; language: RuntimeInterfaceLanguage }>,
): void {
  for (const match of content.matchAll(pattern)) {
    requests.push({ index: match.index ?? 0, language });
  }
}

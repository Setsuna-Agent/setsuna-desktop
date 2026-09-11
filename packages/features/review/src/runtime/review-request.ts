import type {
  ReviewTarget,
  ReviewTurnRequest,
} from '../contracts/index.js';
import type {
  RuntimeConfiguredModelReference,
  RuntimeInterfaceLanguage,
} from '@setsuna-desktop/contracts';

export function createReviewTurnRequest(
  target: ReviewTarget,
  language: RuntimeInterfaceLanguage,
  modelSelection?: RuntimeConfiguredModelReference,
  conversationModelSelection?: RuntimeConfiguredModelReference,
): ReviewTurnRequest {
  const localized = localizedReviewRequest(target, language);
  return Object.freeze({
    ...localized,
    developerInstructions: reviewDeveloperInstructions(language),
    language,
    ...(conversationModelSelection ? { conversationModelSelection } : {}),
    ...(modelSelection ? { modelSelection } : {}),
  });
}

function localizedReviewRequest(
  target: ReviewTarget,
  language: RuntimeInterfaceLanguage,
): Pick<ReviewTurnRequest, 'displayText' | 'prompt'> {
  if (target.type === 'uncommittedChanges') {
    return {
      displayText: language === 'zh-CN'
        ? '请审查当前项目中尚未提交的代码更改'
        : 'Please review the uncommitted code changes in the current project',
      prompt: reviewPrompt(
        language === 'zh-CN' ? '审查当前未提交的更改。' : 'Review the current uncommitted changes.',
        language,
      ),
    };
  }
  if (target.type === 'baseBranch') {
    return {
      displayText: language === 'zh-CN'
        ? `请审查当前分支相对于“${target.branch}”的代码更改`
        : `Please review the current branch's code changes against '${target.branch}'`,
      prompt: reviewPrompt(
        language === 'zh-CN'
          ? `审查当前分支与“${target.branch}”之间的更改。`
          : `Review the changes between the current branch and '${target.branch}'.`,
        language,
      ),
    };
  }
  if (target.type === 'commit') {
    const shortSha = [...target.sha].slice(0, 7).join('');
    return {
      displayText: language === 'zh-CN'
        ? (target.title ? `请审查提交 ${shortSha}：${target.title}` : `请审查提交 ${shortSha}`)
        : (target.title ? `Please review commit ${shortSha}: ${target.title}` : `Please review commit ${shortSha}`),
      prompt: reviewPrompt(
        language === 'zh-CN'
          ? (target.title ? `审查提交 ${target.sha}：${target.title}。` : `审查提交 ${target.sha}。`)
          : (target.title ? `Review commit ${target.sha}: ${target.title}.` : `Review commit ${target.sha}.`),
        language,
      ),
    };
  }
  return {
    displayText: target.instructions,
    prompt: reviewPrompt(target.instructions, language),
  };
}

function reviewPrompt(scope: string, language: RuntimeInterfaceLanguage): string {
  const instruction = language === 'zh-CN'
    ? '检查相关 diff 并返回审查结果。进度说明和最终结果均遵循用户请求的回复语言；用户后续要求切换语言时随之调整。'
    : "Inspect the relevant diff and return the review findings. Follow the user's requested response language for progress updates and final findings, including later requests to switch language.";
  return `${scope}\n${instruction}`;
}

function reviewDeveloperInstructions(language: RuntimeInterfaceLanguage): string {
  if (language === 'zh-CN') {
    return [
      '当前处于审查模式。只检查并报告发现，不修改文件或实现修复；用户的中途补充不会解除只读限制。',
      '只报告本次更改引入的、独立且可操作的缺陷：正确性错误、功能退化、安全问题，或使变更行为缺少验证的具体测试缺口。',
      '不要报告风格偏好、宽泛重构、推测性风险或已有问题。',
      '先给出简短的纯文本摘要，不加标题。',
      '每项发现使用“[P0-P3] 简短标题 — path:line”（或“path:start-end”），随后简洁解释触发条件和影响。行号范围应尽量小，并指向变更代码。证据不充分时说明置信度。',
      '按严重程度排列发现。没有可操作的发现时简要说明，只列出具体的剩余验证缺口。',
      '审查全程遵循本轮目标回复语言，包括进度更新、工具调用前后的说明、发现标题、解释和最终结论。根据用户请求确定语言，无法判断时使用简体中文；用户后续要求切换语言时随之调整。代码、命令、日志和引用不改变回复语言。',
      '不要添加“审查开始”、“审查结束”或“发现的问题”等标题。',
    ].join('\n');
  }
  return [
    'Review mode is active. Inspect and report findings only; do not modify files or implement fixes. User steering does not lift this read-only restriction.',
    'Report only discrete, actionable defects introduced by the reviewed change: correctness bugs, regressions, security issues, or a specific missing test that leaves changed behavior unverified.',
    'Do not report style preferences, broad refactors, speculative risks, or pre-existing problems.',
    'Begin with a short plain-text summary without a heading.',
    'For each finding, use `[P0-P3] Short title — path:line` (or `path:start-end`), followed by a concise explanation of the failure condition and impact. Keep line ranges minimal and tied to the changed code. Include confidence when evidence is incomplete.',
    'Order findings by severity. If there are no actionable findings, say so briefly and list only concrete residual validation gaps.',
    "Use the turn's target response language throughout the review, including progress updates, explanations before and after tools, finding titles, and final conclusions. Follow the user's request, defaulting to English only when its language is unclear, and honor later requests to switch language. Code, commands, logs, and quotations do not change the response language.",
    'Do not add headings such as “Review started”, “Review completed”, or “Findings”.',
  ].join('\n');
}

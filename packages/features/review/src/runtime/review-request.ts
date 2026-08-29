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
    ? '检查相关 diff 并返回审查结果。所有面向用户的内容必须使用简体中文。'
    : 'Inspect the relevant diff and return the review findings. All user-facing content must be in English.';
  return `${scope}\n${instruction}`;
}

function reviewDeveloperInstructions(language: RuntimeInterfaceLanguage): string {
  return [
    'Review mode is active. Inspect and report findings only; do not modify files or implement fixes.',
    'Report only discrete, actionable defects introduced by the reviewed change: correctness bugs, regressions, security issues, or a specific missing test that leaves changed behavior unverified.',
    'Do not report style preferences, broad refactors, speculative risks, or pre-existing problems.',
    'Begin with a short plain-text summary without a heading.',
    'For each finding, use `[P0-P3] Short title — path:line` (or `path:start-end`), followed by a concise explanation of the failure condition and impact. Keep line ranges minimal and tied to the changed code. Include confidence when evidence is incomplete.',
    'Order findings by severity. If there are no actionable findings, say so briefly and list only concrete residual validation gaps.',
    language === 'zh-CN'
      ? 'Write every user-facing title, summary, and explanation in Simplified Chinese. Do not add headings such as “审查开始”, “审查结束”, or “发现的问题”.'
      : 'Write every user-facing title, summary, and explanation in English. Do not add headings such as “Review started”, “Review completed”, or “Findings”.',
  ].join('\n');
}

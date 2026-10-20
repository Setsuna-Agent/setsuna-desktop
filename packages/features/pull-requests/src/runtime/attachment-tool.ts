import { runtimeText } from '@setsuna-desktop/contracts';
import { ATTACH_PULL_REQUEST_TOOL, parsePullRequestUrl, pullRequestUrl, type PullRequestToolService } from '../contracts/index.js';

export const pullRequestAttachmentTool: PullRequestToolService = {
  listTools(context) {
    if (context.readOnly) return [];
    const t = runtimeText(context.interfaceLanguage);
    return [{
      name: ATTACH_PULL_REQUEST_TOOL,
      description: t('Attach a created GitHub pull request to this conversation. Call once for every PR created, including multiple PRs in the same task. This only records the association; it does not create or modify the PR.', '将已创建的 GitHub PR 关联到当前对话。每个创建成功的 PR 都调用一次，同一任务的多个 PR 分别关联。此工具只记录关联，不创建或修改远端 PR。'),
      inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'GitHub pull request URL' } }, required: ['url'], additionalProperties: false },
    }];
  },
  systemPrompt(context) {
    if (context.readOnly) return null;
    return runtimeText(context.interfaceLanguage)(
      'After successfully creating a GitHub pull request, always call attach_pull_request with its URL, regardless of which tool or script created it. Attach every created PR when there are several. Do not attach PRs merely mentioned as references or examples.',
      '成功创建 GitHub PR 后，无论使用什么工具或脚本，都必须用其 URL 调用 attach_pull_request。同一对话创建多个 PR 时逐个关联。不要关联仅作为参考或示例提及的 PR。',
    );
  },
  attach(input) {
    const url = input && typeof input === 'object' && 'url' in input ? input.url : null;
    const reference = parsePullRequestUrl(url);
    if (!reference) throw new Error('Expected a GitHub pull request URL.');
    return { content: `Attached ${pullRequestUrl(reference)}`, data: { resultKind: 'pull-requests.attachment', reference } };
  },
};

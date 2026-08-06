import { pathToFileURL } from 'node:url';

const PRIORITY_BADGE_PATTERN = /!\[P(\d+) Badge\]\([^\r\n)]*\)/i;

/**
 * Split Codex inline review comments into merge-blocking and advisory findings.
 * Unknown formats fail closed so a connector format change cannot silently
 * weaken the required review gate.
 */
export function classifyCodexReviewFindings(comments) {
  if (!Array.isArray(comments)) {
    throw new TypeError('Expected an array of Codex review comments.');
  }

  const result = {
    blocking: [],
    advisory: [],
  };

  for (const [index, comment] of comments.entries()) {
    if (comment === null || typeof comment !== 'object') {
      throw new TypeError(`Expected review comment ${index} to be an object.`);
    }
    if (typeof comment.url !== 'string' || comment.url.length === 0) {
      throw new TypeError(`Expected review comment ${index} to have a URL.`);
    }

    const body = typeof comment.body === 'string' ? comment.body : '';
    const priorityMatch = body.match(PRIORITY_BADGE_PATTERN);
    const priorityNumber = priorityMatch === null
      ? null
      : Number.parseInt(priorityMatch[1], 10);
    const finding = {
      priority: priorityNumber === null ? 'unknown' : `P${priorityNumber}`,
      url: comment.url,
    };

    if (priorityNumber === null || priorityNumber <= 1) {
      result.blocking.push(finding);
    } else {
      result.advisory.push(finding);
    }
  }

  return result;
}

async function runCli() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const comments = JSON.parse(input);
  process.stdout.write(`${JSON.stringify(classifyCodexReviewFindings(comments))}\n`);
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

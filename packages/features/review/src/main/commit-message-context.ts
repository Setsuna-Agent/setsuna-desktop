import { runGit } from './git-command.js';

/** Git computes the amend preview against HEAD's parent, including partial staging and untracked files. */
export async function readCommitMessageContext(gitRoot: string, oid: string): Promise<string> {
  const [metadata, currentAuthor, status] = await Promise.all([
    runGit(['show', '--no-patch', '--format=%an <%ae>%nDate:   %ad', '--date=default', oid], gitRoot),
    runGit(['var', 'GIT_AUTHOR_IDENT'], gitRoot).catch(() => null),
    readAmendStatus(gitRoot),
  ]);
  const [author, date] = metadata.split('\n');
  const authorLine = currentAuthor?.startsWith(author + ' ') ? '' : `Author: ${author}\n`;
  return `${authorLine}${date}\n\n${status}`;
}

async function readAmendStatus(gitRoot: string): Promise<string> {
  try {
    return await runGit([
      '-c', 'color.status=false', '-c', 'advice.statusHints=false',
      'commit', '--dry-run', '--amend', '--long', '--untracked-files=normal',
    ], gitRoot);
  } catch (error) {
    // An empty amend or unresolved files return exit 1 along with a valid status preview.
    if (error && typeof error === 'object' && 'code' in error && error.code === 1
      && 'stdout' in error && typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout.trim();
    throw error;
  }
}

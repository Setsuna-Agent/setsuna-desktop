import { expect, it } from 'vitest';
import { githubCommitUrl } from '../../src/main/git-commit-url.js';

it('derives credential-free commit links from GitHub remotes and omits non-GitHub targets', () => {
  const oid = 'a'.repeat(40);
  for (const remote of ['git@github.com:owner/repo.git', 'ssh://git@github.com/owner/repo.git', 'https://github.com/owner/repo.git', 'https://user:secret@github.com/owner/repo']) {
    expect(githubCommitUrl(remote, oid)).toBe(`https://github.com/owner/repo/commit/${oid}`);
  }
  for (const remote of ['', '/local/repo', 'git@gitlab.com:owner/repo.git', 'https://github.com.evil.test/owner/repo', 'https://github.com/owner/repo/extra', 'file://github.com/owner/repo']) {
    expect(githubCommitUrl(remote, oid)).toBeNull();
  }
});

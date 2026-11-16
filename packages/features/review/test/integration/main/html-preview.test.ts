import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ReviewFilePreviewRegistry, DesktopReviewFileVersionInput } from '../../../src/contracts/index.js';
import { runGit } from '../../../src/main/git-command.js';
import { createReviewHtmlPreviewUrl } from '../../../src/main/html-preview.js';

it('previews HTML and relative assets from the selected Git version, including deletion and workspace boundaries', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-review-html-'));
  try {
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(root, 'no-global-config'));
    await runGit(['init', '-b', 'main'], root);
    await runGit(['config', 'user.name', 'Review Test'], root);
    await runGit(['config', 'user.email', 'review@example.test'], root);
    await runGit(['config', 'core.autocrlf', 'false'], root);
    const workspace = path.join(root, 'web');
    const site = path.join(workspace, 'site');
    await mkdir(site, { recursive: true });
    await writeFile(path.join(root, 'secret.html'), 'outside workspace');
    const html = (version: string) => `<link rel="stylesheet" href="./style.css"><h1>${version}</h1>`;
    const write = async (version: string) => {
      await writeFile(path.join(site, 'index.HTML'), html(version));
      await writeFile(path.join(site, 'style.css'), `/* ${version} */`);
    };
    await write('committed');
    await runGit(['add', '.'], root);
    await runGit(['commit', '-m', 'Add HTML'], root);
    const oid = await runGit(['rev-parse', 'HEAD'], root);
    await write('staged');
    await runGit(['add', '.'], root);
    await write('worktree');
    const registerHtmlPreview = vi.fn<ReviewFilePreviewRegistry['registerHtmlPreview']>(() => ({ previewId: 'html', url: 'preview://html' }));
    const previews: ReviewFilePreviewRegistry = {
      registerHtmlPreview, registerContentPreview: vi.fn(), release: vi.fn(),
      createWorkspacePreview: async () => { throw new Error('Historical previews must not use the worktree.'); },
    };
    const versions: Array<[DesktopReviewFileVersionInput, string]> = [
      [{ source: 'staged', side: 'after', filePath: 'site/index.HTML' }, 'staged'],
      [{ source: 'unstaged', side: 'before', filePath: 'site/index.HTML' }, 'staged'],
      [{ source: 'commit', side: 'after', filePath: 'site/index.HTML', revisions: { before: null, after: oid } }, 'committed'],
    ];
    for (const [input, version] of versions) {
      expect((await createReviewHtmlPreviewUrl(workspace, input, previews)).ok).toBe(true);
      const registration = registerHtmlPreview.mock.calls.at(-1)![0];
      expect(registration.content).toBe(html(version));
      expect(Buffer.from((await registration.readResource('site/style.css'))!).toString()).toBe(`/* ${version} */`);
      expect(await registration.readResource('../secret.html')).toBeNull();
      expect(await registration.readResource(path.join(root, 'secret.html'))).toBeNull();
    }
    await rm(site, { recursive: true });
    await runGit(['add', '.'], root);
    await runGit(['commit', '-m', 'Delete HTML'], root);
    const deletedOid = await runGit(['rev-parse', 'HEAD'], root);
    const deleted: DesktopReviewFileVersionInput = {
      source: 'commit', side: 'before', filePath: 'site/index.HTML', revisions: { before: oid, after: deletedOid },
    };
    expect((await createReviewHtmlPreviewUrl(workspace, deleted, previews)).ok).toBe(true);
    const before = registerHtmlPreview.mock.calls.at(-1)![0];
    expect(before.content).toBe(html('committed'));
    expect(Buffer.from((await before.readResource('site/style.css'))!).toString()).toBe('/* committed */');
    expect((await createReviewHtmlPreviewUrl(workspace, { ...deleted, side: 'after' }, previews)).ok).toBe(false);
    expect((await createReviewHtmlPreviewUrl(workspace, { ...deleted, filePath: '../secret.html' }, previews)).ok).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

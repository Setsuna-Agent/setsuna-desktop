import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(repositoryRoot, 'Tree.md');
const ignoredDirectories = new Set([
  '.cache', '.git', '.idea', '.turbo', '.vscode', 'dist', 'node_modules', 'release-artifacts',
]);
const ignoredFileExtensions = new Set([
  // TypeScript incremental state may exist locally but is absent from clean CI checkouts.
  '.tsbuildinfo',
]);
const indexedRoots = [
  'apps/desktop/main',
  'apps/desktop/preload',
  'apps/desktop/renderer',
  'packages/contracts',
  'packages/desktop-runtime',
  'scripts',
  'skills',
  'plugins',
  'docs',
];
const routeMap = [
  ['Electron 启动与 IPC', '`apps/desktop/main/src/index.ts`、`apps/desktop/main/src/ipc/`'],
  ['preload 安全桥', '`apps/desktop/preload/src/index.ts`'],
  ['renderer 顶层编排', '`apps/desktop/renderer/src/app/`'],
  ['聊天、设置、能力、工作区', '`apps/desktop/renderer/src/features/`'],
  ['runtime client 与事件同步', '`apps/desktop/renderer/src/services/runtime-client/`'],
  ['共享 UI、样式与偏好', '`apps/desktop/renderer/src/shared/`'],
  ['共享 DTO 与事件 reducer', '`packages/contracts/src/`'],
  ['Agent turn 生命周期', '`packages/desktop-runtime/src/loop/{core,context,lifecycle,memory,tools}/`'],
  ['runtime HTTP/SSE', '`packages/desktop-runtime/src/server/`'],
  ['存储、模型、MCP、工具实现', '`packages/desktop-runtime/src/adapters/`'],
  ['runtime 抽象边界', '`packages/desktop-runtime/src/ports/`'],
  ['单元与集成测试', '各模块独立的 `test/`，目录镜像对应 `src/`'],
];

async function directoryStats(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let directFiles = 0;
  let totalFiles = 0;
  const directories = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.isDirectory()) {
      const child = await directoryStats(path.join(directory, entry.name));
      if (child.totalFiles === 0) continue;
      directories.push({ name: entry.name, ...child });
      totalFiles += child.totalFiles;
    } else if (entry.isFile() && !ignoredFileExtensions.has(path.extname(entry.name))) {
      directFiles += 1;
      totalFiles += 1;
    }
  }
  directories.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  return { directFiles, totalFiles, directories };
}

function renderDirectory(node, prefix = '', depth = 0, maxDepth = 5) {
  if (depth >= maxDepth) return [];
  const lines = [];
  node.directories.forEach((child, index) => {
    const last = index === node.directories.length - 1;
    const branch = last ? '└── ' : '├── ';
    const countLabel = child.directFiles ? ` — ${child.directFiles} direct / ${child.totalFiles} total files` : ` — ${child.totalFiles} files`;
    lines.push(`${prefix}${branch}${child.name}/${countLabel}`);
    const nextPrefix = `${prefix}${last ? '    ' : '│   '}`;
    lines.push(...renderDirectory(child, nextPrefix, depth + 1, maxDepth));
  });
  return lines;
}

function normalizeLineEndings(content) {
  // Git may check out text as CRLF on Windows while generated content uses LF.
  return content.replace(/\r\n?/gu, '\n');
}

async function buildTreeDocument() {
  const sections = [];
  for (const relativeRoot of indexedRoots) {
    const absoluteRoot = path.join(repositoryRoot, relativeRoot);
    if (!existsSync(absoluteRoot)) continue;
    const stats = await directoryStats(absoluteRoot);
    const lines = [`${relativeRoot}/ — ${stats.directFiles} direct / ${stats.totalFiles} total files`];
    lines.push(...renderDirectory(stats));
    sections.push(`### \`${relativeRoot}/\`\n\n\`\`\`text\n${lines.join('\n')}\n\`\`\``);
  }

  const routeRows = routeMap.map(([change, location]) => `| ${change} | ${location} |`).join('\n');
  return `# Repository Tree\n\n> 此文件由 \`pnpm docs:tree\` 生成。不要手工维护逐文件清单；职责和设计约束写在 \`docs/\`。\n\n## 分层方向\n\n\`contracts -> runtime -> Electron main/preload -> renderer\`\n\n- 生产代码只放在各模块的 \`src/\`。\n- 测试只放在独立的 \`test/\`，并镜像生产目录。\n- renderer 按 \`app / features / services / shared\` 组织。\n- runtime 的 Agent loop 按 \`core / context / lifecycle / memory / tools\` 组织，实现通过 ports/adapters 隔离。\n\n## 常用入口\n\n| 改动类型 | 入口 |\n| --- | --- |\n${routeRows}\n\n## 目录索引\n\n目录后的数字分别表示直属文件数和递归文件总数；生成物与依赖目录不会进入索引。\n\n${sections.join('\n\n')}\n`;
}

const nextDocument = await buildTreeDocument();
if (process.argv.includes('--check')) {
  const currentDocument = existsSync(outputPath) ? await readFile(outputPath, 'utf8') : '';
  if (normalizeLineEndings(currentDocument) !== normalizeLineEndings(nextDocument)) {
    console.error('Tree.md is out of date. Run `pnpm docs:tree`.');
    process.exitCode = 1;
  } else {
    console.log('Tree.md is up to date.');
  }
} else {
  await writeFile(outputPath, nextDocument, 'utf8');
  console.log('Updated Tree.md.');
}

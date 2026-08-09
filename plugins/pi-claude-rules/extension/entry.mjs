import { readdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_DEPTH = 6;
const MAX_RULE_FILES = 100;

export default function activate(api) {
  api.on('session.start', async (_payload, context) => {
    if (typeof context.cwd !== 'string' || !context.cwd) return {};
    const rulesRoot = path.join(context.cwd, '.claude', 'rules');
    const files = await findMarkdownFiles(rulesRoot);
    if (!files.length) return {};
    const suffix = files.length === MAX_RULE_FILES ? '\n- …更多规则未列出' : '';
    return {
      context: [
        [
          'Project rules are available under .claude/rules:',
          ...files.map((file) => `- .claude/rules/${file}`),
          suffix,
          'Read the relevant rule files before changing code covered by them.',
        ].filter(Boolean).join('\n'),
      ],
    };
  });
}

async function findMarkdownFiles(root) {
  const results = [];
  await visit(root, '', 0, results);
  return results;
}

async function visit(directory, relativeDirectory, depth, results) {
  if (depth > MAX_DEPTH || results.length >= MAX_RULE_FILES) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return;
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (results.length >= MAX_RULE_FILES) break;
    if (entry.isSymbolicLink()) continue;
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await visit(path.join(directory, entry.name), relativePath, depth + 1, results);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(relativePath.replaceAll('\\', '/'));
    }
  }
}

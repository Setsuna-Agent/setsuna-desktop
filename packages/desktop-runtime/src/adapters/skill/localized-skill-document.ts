import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** 同目录保留相同的脚本和依赖；只有入口 Markdown 随语言切换。 */
export async function readLocalizedSkillDocument(skillPath: string, language?: RuntimeInterfaceLanguage) {
  if (language) {
    const localizedPath = path.join(path.dirname(skillPath), `SKILL.${language}.md`);
    const content = await readFile(localizedPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (content !== null) return { path: localizedPath, content, localized: true };
  }
  return { path: skillPath, content: await readFile(skillPath, 'utf8').catch(() => ''), localized: false };
}

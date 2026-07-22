// @ts-nocheck

/** Parsing and application of app-server-style text patches. */

export function parseApplyPatch(patch) {
  const text = normalizeApplyPatchText(patch);
  const lines = text.split('\n');
  if (lines[0] !== '*** Begin Patch') {
    return { ok: false, error: 'apply_patch 补丁必须以 *** Begin Patch 开头。' };
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line === '*** End Patch');
  if (endIndex < 0) return { ok: false, error: 'apply_patch 补丁缺少 *** End Patch。' };

  const operations = [];
  let index = 1;
  let environmentId = '';
  while (index < endIndex) {
    const line = lines[index];
    if (!line) {
      index += 1;
      continue;
    }
    if (line.startsWith('*** Environment ID: ')) {
      if (operations.length) return { ok: false, error: 'apply_patch environment_id must appear before file hunks.' };
      if (environmentId) return { ok: false, error: 'apply_patch environment_id cannot be specified more than once.' };
      environmentId = line.slice('*** Environment ID: '.length).trim();
      if (!environmentId) return { ok: false, error: 'apply_patch environment_id cannot be empty.' };
      index += 1;
      continue;
    }
    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length).trim();
      const contentLines = [];
      index += 1;
      while (index < endIndex && !isApplyPatchFileHeader(lines[index])) {
        contentLines.push(lines[index]);
        index += 1;
      }
      const hasPlainContent = contentLines.some((contentLine) => contentLine && !contentLine.startsWith('+'));
      const normalizedContentLines = hasPlainContent
        ? contentLines
        : contentLines.map((contentLine) => (contentLine.startsWith('+') ? contentLine.slice(1) : ''));
      operations.push({
        type: 'add',
        path: filePath,
        content: normalizedContentLines.length ? `${normalizedContentLines.join('\n')}\n` : '',
      });
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      operations.push({
        type: 'delete',
        path: line.slice('*** Delete File: '.length).trim(),
      });
      index += 1;
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length).trim();
      const hunks = [];
      let moveTo = '';
      index += 1;
      if (lines[index]?.startsWith('*** Move to: ')) {
        moveTo = lines[index].slice('*** Move to: '.length).trim();
        index += 1;
      }
      while (index < endIndex && !isApplyPatchFileHeader(lines[index])) {
        if (!lines[index].startsWith('@@')) {
          return { ok: false, error: `更新文件 ${filePath} 的 hunk 必须以 @@ 开头。` };
        }
        index += 1;
        const hunkLines = [];
        while (index < endIndex && !lines[index].startsWith('@@') && !isApplyPatchFileHeader(lines[index])) {
          const hunkLine = lines[index];
          if (hunkLine === '*** End of File') {
            index += 1;
            continue;
          }
          if (!hunkLine || !' +-'.includes(hunkLine[0])) {
            return { ok: false, error: `更新文件 ${filePath} 的变更行必须以空格、+ 或 - 开头。` };
          }
          hunkLines.push(hunkLine);
          index += 1;
        }
        hunks.push(hunkLines);
      }
      operations.push({
        type: 'update',
        path: filePath,
        moveTo,
        hunks,
      });
      continue;
    }
    return { ok: false, error: `无法识别的 apply_patch 行：${line}` };
  }
  return { ok: true, operations, environmentId };
}

function normalizeApplyPatchText(patch) {
  const text = String(patch || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const lines = text.split('\n');
  if (lines[0] === '*** Begin Patch') return text;
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (
    lines.length >= 4
    && (first === '<<EOF' || first === "<<'EOF'" || first === '<<"EOF"')
    && String(last || '').endsWith('EOF')
  ) {
    return lines.slice(1, -1).join('\n');
  }
  return text;
}

function isApplyPatchFileHeader(line) {
  return String(line || '').startsWith('*** Add File: ')
    || String(line || '').startsWith('*** Update File: ')
    || String(line || '').startsWith('*** Delete File: ');
}

export function applyPatchHunks(content, hunks, label) {
  let nextContent = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const useCrLf = /\r\n/.test(String(content || ''));
  let cursor = 0;
  for (const hunk of hunks) {
    const oldPart = hunk
      .filter((line) => line.startsWith(' ') || line.startsWith('-'))
      .map((line) => line.slice(1))
      .join('\n');
    const newPart = hunk
      .filter((line) => line.startsWith(' ') || line.startsWith('+'))
      .map((line) => line.slice(1))
      .join('\n');
    if (!oldPart) return { ok: false, error: `补丁 ${label} 中存在空匹配片段。` };
    const withNewlineOld = `${oldPart}\n`;
    const withNewlineNew = `${newPart}\n`;
    let start = nextContent.indexOf(withNewlineOld, cursor);
    let searchOld = withNewlineOld;
    let replacement = withNewlineNew;
    if (start < 0) {
      start = nextContent.indexOf(oldPart, cursor);
      searchOld = oldPart;
      replacement = newPart;
    }
    if (start < 0) {
      return { ok: false, error: `补丁无法应用到 ${label}：未找到匹配的旧内容。` };
    }
    nextContent = `${nextContent.slice(0, start)}${replacement}${nextContent.slice(start + searchOld.length)}`;
    cursor = start + replacement.length;
  }
  return {
    ok: true,
    content: useCrLf ? nextContent.replace(/\n/g, '\r\n') : nextContent,
  };
}

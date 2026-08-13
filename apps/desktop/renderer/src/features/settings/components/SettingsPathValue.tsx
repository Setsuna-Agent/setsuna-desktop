export function SettingsPathValue({ path }: { path: string }) {
  const { directory, name, separator } = settingsPathParts(path);
  return (
    <span className="chat-user-settings__path-value" title={path}>
      {directory ? (
        <span className="chat-user-settings__path-directory">{directory}</span>
      ) : null}
      {directory ? (
        <span className="chat-user-settings__path-separator">{separator}</span>
      ) : null}
      <span className="chat-user-settings__path-name">{name}</span>
    </span>
  );
}

export function settingsPathParts(path: string): {
  directory: string;
  name: string;
  separator: '/' | '\\';
} {
  const value = trimTrailingSeparators(path.trim());
  const slashIndex = value.lastIndexOf('/');
  const backslashIndex = value.lastIndexOf('\\');
  const separatorIndex = Math.max(slashIndex, backslashIndex);
  if (separatorIndex < 0 || separatorIndex === value.length - 1) {
    return { directory: '', name: value, separator: slashIndex >= backslashIndex ? '/' : '\\' };
  }
  return {
    // 根路径属于最先被省略的信息；先移除它也可避免 RTL 省略时把开头的分隔符移到末尾。
    directory: stripPathRoot(value.slice(0, separatorIndex)),
    name: value.slice(separatorIndex + 1),
    separator: value[separatorIndex] as '/' | '\\',
  };
}

function stripPathRoot(path: string): string {
  if (/^[a-z]:$/iu.test(path)) return '';
  return path.replace(/^[a-z]:[\\/]+/iu, '').replace(/^[\\/]+/u, '');
}

function trimTrailingSeparators(path: string): string {
  if (path === '/' || path === '\\' || /^[a-z]:[\\/]$/iu.test(path)) return path;
  return path.replace(/[\\/]+$/u, '') || path;
}

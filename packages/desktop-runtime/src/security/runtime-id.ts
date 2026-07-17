import path from 'node:path';

const MAX_RUNTIME_ID_CHARS = 192;
const SAFE_RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * runtime ID 是不透明存储键，绝不是文件系统路径。即使调用方也会校验解码后的路由参数，
 * 仍需在存储边界保留校验。
 */
export function assertSafeRuntimeId(value: string, label = 'Runtime id'): string {
  if (
    !value
    || value.length > MAX_RUNTIME_ID_CHARS
    || value === '.'
    || value === '..'
    || !SAFE_RUNTIME_ID.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

/** 解析生成的存储文件名，并验证其仍位于根目录之下。 */
export function resolveRuntimeStoragePath(root: string, fileName: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, fileName);
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Runtime storage path escapes its root.');
  }
  return target;
}

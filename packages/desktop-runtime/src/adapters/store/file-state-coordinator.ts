import path from 'node:path';

const fileStateQueues = new Map<string, Promise<void>>();

/**
 * 串行处理单个持久化状态文件的读取、修改与写入操作。
 *
 * 此协调器有意在存储实例间共享，因为测试及未来的 runtime 组合可能会为同一路径
 * 创建多个适配器。
 */
export async function withFileStateUpdate<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath);
  const previous = fileStateQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current, () => current);
  fileStateQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (fileStateQueues.get(key) === queued) fileStateQueues.delete(key);
  }
}

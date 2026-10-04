import type { ToolExecutionContext } from '../../ports/tool-host.js';
import { MAX_CONFIGURE_PLUGIN_FILES, MAX_CONFIGURE_PLUGIN_TEXT_BYTES } from './configure-plugin-tool.js';
import { openValidatedReadableFile } from './pc-local/pc-local-tool-secure-read.js';
import { objectInput, requiredStringArg } from './tool-input.js';

const FILE_INPUT_HELP = 'Each files item must be {path, sourcePath} or {path, content}. Prefer sourcePath for workspace files; do not rebuild their contents as XML, HTML entities or Base64.';

/** Resolve references before previewing, and again before execution, so approval binds to bytes. */
export async function resolveConfigurePluginSources(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
  const args = objectInput(input);
  if (!Array.isArray(args.files)) throw new Error(`files must be an array. ${FILE_INPUT_HELP}`);
  // Diagnose malformed transport shapes before file-count errors obscure the recovery path.
  for (const [index, value] of args.files.entries()) {
    const file = objectInput(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof file.path !== 'string'
      || (file.content === undefined) === (file.sourcePath === undefined)
      || (file.content !== undefined && typeof file.content !== 'string')
      || (file.sourcePath !== undefined && typeof file.sourcePath !== 'string')) {
      throw new Error(`configure_plugin.files[${index}] is invalid. ${FILE_INPUT_HELP}`);
    }
  }
  if (args.files.length > MAX_CONFIGURE_PLUGIN_FILES) {
    throw new Error(`configure_plugin supports at most ${MAX_CONFIGURE_PLUGIN_FILES} text files.`);
  }
  let remainingBytes = MAX_CONFIGURE_PLUGIN_TEXT_BYTES - Buffer.byteLength(JSON.stringify(args.manifest ?? {}));
  const files: Record<string, unknown>[] = [];
  for (const value of args.files) {
    const file = objectInput(value);
    const { sourcePath, ...resolved } = file;
    if (sourcePath !== undefined) {
      if (!context?.environment?.workspaceRoot) throw new Error('sourcePath requires a current workspace.');
      resolved.content = await readSourceText(requiredStringArg(sourcePath, 'sourcePath'), context, remainingBytes);
    }
    remainingBytes -= Buffer.byteLength(resolved.content as string);
    if (remainingBytes < 0) throw inputTooLarge();
    files.push(resolved);
  }
  return { ...args, files };
}

async function readSourceText(sourcePath: string, context: ToolExecutionContext, remainingBytes: number): Promise<string> {
  const opened = await openValidatedReadableFile(sourcePath, {
    root: context.environment!.workspaceRoot,
    permissionProfile: context.permissionProfile,
    sandboxWorkspaceWrite: context.sandboxWorkspaceWrite,
    directToolReadableRoots: context.directToolReadableRoots,
  });
  try {
    if (!opened.info.isFile()) throw new Error(`sourcePath must reference a regular file: ${sourcePath}`);
    if (opened.info.size > remainingBytes) throw inputTooLarge();
    // Read at most the remaining budget plus one byte, even if a file grows after stat.
    const buffer = Buffer.alloc(Math.min(64 * 1024, remainingBytes + 1));
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      context.signal?.throwIfAborted();
      const { bytesRead } = await opened.handle.read(buffer, 0, Math.min(buffer.length, remainingBytes - total + 1), null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > remainingBytes) throw inputTooLarge();
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const bytes = Buffer.concat(chunks);
    const content = bytes.toString('utf8');
    if (!Buffer.from(content, 'utf8').equals(bytes)) throw new Error(`sourcePath must contain UTF-8 text: ${sourcePath}`);
    return content;
  } finally {
    await opened.handle.close();
  }
}

function inputTooLarge(): Error {
  return new Error(`configure_plugin text input exceeds ${MAX_CONFIGURE_PLUGIN_TEXT_BYTES} bytes.`);
}

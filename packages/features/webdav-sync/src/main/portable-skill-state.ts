import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_SKILL_STATE_BYTES = 2 * 1024 * 1024;

type SkillState = { enabled?: boolean };
type SkillStateFile = { version: 1; states: Record<string, SkillState> };

/** Keeps only state belonging to user-owned Skill directories. */
export async function createPortableSkillStateSnapshot(input: {
  sourcePath: string;
  userSkillsRoot: string;
  destinationPath: string;
}): Promise<void> {
  const [state, userSkillIds] = await Promise.all([
    readOptionalState(input.sourcePath),
    listUserSkillIds(input.userSkillsRoot),
  ]);
  const portable: SkillStateFile = {
    version: 1,
    states: Object.fromEntries([...userSkillIds].flatMap((id) => (
      state.states[id] ? [[id, state.states[id]] as const] : []
    ))),
  };
  await mkdir(path.dirname(input.destinationPath), { recursive: true });
  await writeFile(input.destinationPath, `${JSON.stringify(portable, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

/**
 * Replaces state for the user Skill domain while preserving bundled, Plugin and
 * external-Skill state that belongs to the target device.
 */
export async function mergePortableSkillStateForRestore(input: {
  localPath: string;
  localUserSkillsRoot: string;
  portablePath: string;
  portableUserSkillsRoot: string;
}): Promise<void> {
  const [local, localUserSkillIds, backup, backupUserSkillIds] = await Promise.all([
    readOptionalState(input.localPath),
    listUserSkillIds(input.localUserSkillsRoot),
    readState(input.portablePath),
    listUserSkillIds(input.portableUserSkillsRoot),
  ]);
  const preserved = Object.entries(local.states)
    .filter(([id]) => !localUserSkillIds.has(id));
  const merged: SkillStateFile = {
    version: 1,
    states: Object.fromEntries([
      ...preserved,
      ...Object.entries(backup.states).filter(([id]) => backupUserSkillIds.has(id)),
    ]),
  };
  await writeFile(input.portablePath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
}

async function listUserSkillIds(root: string): Promise<Set<string>> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (isMissingFileError(error)) return [];
    throw error;
  });
  return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
}

async function readOptionalState(filePath: string): Promise<SkillStateFile> {
  return readState(filePath).catch((error) => {
    if (isMissingFileError(error)) return { version: 1, states: {} };
    throw error;
  });
}

async function readState(filePath: string): Promise<SkillStateFile> {
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_SKILL_STATE_BYTES) {
    throw new Error('Skill 状态不是受支持的普通 JSON 文件。');
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error('Skill 状态文件格式无效。', { cause: error });
  }
  if (!isRecord(value) || !isRecord(value.states)) {
    throw new Error('Skill 状态文件格式无效。');
  }
  const states = Object.fromEntries(Object.entries(value.states).flatMap(([id, rawState]) => {
    if (!id || !isRecord(rawState)) return [];
    const state: SkillState = {
      ...(typeof rawState.enabled === 'boolean' ? { enabled: rawState.enabled } : {}),
    };
    return [[id, state] as const];
  }));
  return { version: 1, states };
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

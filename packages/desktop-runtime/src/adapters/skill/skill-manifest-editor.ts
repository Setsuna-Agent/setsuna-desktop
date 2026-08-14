import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { errorMessage, isNodeErrorCode } from '../../shared/node-errors.js';

/** Reads the optional Codex Skill manifest without hiding non-ENOENT failures. */
export async function readOptionalSkillManifest(skillPath: string): Promise<string | undefined> {
  const manifestPath = path.join(path.dirname(skillPath), 'agents', 'openai.yaml');
  return readFile(manifestPath, 'utf8').catch((error: unknown) => {
    if (isNodeErrorCode(error, 'ENOENT')) return undefined;
    throw error;
  });
}

/** Updates owned manifest fields while preserving every unrelated Plugin field. */
export function mergeSkillManifest(
  existingContent: string | undefined,
  dependencyTools: Record<string, unknown>[] | undefined,
  displayName: string | undefined,
): string | null | undefined {
  if (dependencyTools === undefined && (displayName === undefined || existingContent === undefined)) {
    return undefined;
  }
  let root: Record<string, unknown> = {};
  if (existingContent !== undefined) {
    try {
      const parsed = parseYaml(existingContent, { maxAliasCount: 0, uniqueKeys: true });
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        root = parsed as Record<string, unknown>;
      } else if (dependencyTools !== undefined) {
        throw new Error('manifest root must be an object');
      } else {
        return undefined;
      }
    } catch (error) {
      if (dependencyTools === undefined) return undefined;
      throw new Error(`Cannot update MCP dependencies in an invalid agents/openai.yaml: ${errorMessage(error)}`);
    }
  }
  if (displayName !== undefined && existingContent !== undefined) {
    root.interface = {
      ...recordValue(root.interface),
      display_name: displayName.trim(),
    };
  }
  if (dependencyTools !== undefined) {
    const dependencyConfig = recordValue(root.dependencies);
    if (dependencyTools.length) {
      root.dependencies = { ...dependencyConfig, tools: dependencyTools };
    } else {
      delete dependencyConfig.tools;
      if (Object.keys(dependencyConfig).length) root.dependencies = dependencyConfig;
      else delete root.dependencies;
    }
  }
  return Object.keys(root).length ? stringifyYaml(root, { lineWidth: 0 }) : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

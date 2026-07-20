import path from 'node:path';
import type { WorkspaceSearchEngine } from '../../ports/workspace-search-engine.js';
import { JavaScriptWorkspaceSearchEngine } from './javascript-workspace-search-engine.js';
import { RipgrepWorkspaceSearchEngine } from './ripgrep-workspace-search-engine.js';

type CreateWorkspaceSearchEngineOptions = {
  ripgrepPath?: string;
  requireBundledRipgrep?: boolean;
};

export function createWorkspaceSearchEngine(
  options: CreateWorkspaceSearchEngineOptions = {},
): WorkspaceSearchEngine {
  const ripgrepPath = String(options.ripgrepPath ?? process.env.SETSUNA_DESKTOP_RG_PATH ?? '').trim();
  const required = options.requireBundledRipgrep
    ?? process.env.SETSUNA_DESKTOP_REQUIRE_BUNDLED_RG === '1';
  if (!ripgrepPath) {
    if (required) throw new Error('Bundled ripgrep path is required by the packaged runtime.');
    return new JavaScriptWorkspaceSearchEngine();
  }
  if (!path.isAbsolute(ripgrepPath)) throw new Error('SETSUNA_DESKTOP_RG_PATH must be absolute.');
  const fallback = required ? undefined : new JavaScriptWorkspaceSearchEngine();
  return new RipgrepWorkspaceSearchEngine({ executablePath: ripgrepPath, fallback });
}

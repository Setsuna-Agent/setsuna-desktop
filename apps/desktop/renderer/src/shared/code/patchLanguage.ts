import type { SupportedLanguages } from '@pierre/diffs';

/**
 * Vue hunks often start inside a distant <script> or <style> block. Without
 * that opening tag, the Vue grammar treats a truncated script hunk as plain
 * template text, so select the embedded language when the retained lines are
 * unambiguous. Pierre still owns parsing, diffing, and Shiki rendering.
 */
export function inferPatchLanguageOverride(
  path: string,
  patch: string,
): SupportedLanguages | undefined {
  if (!path.toLowerCase().endsWith('.vue')) return undefined;
  const lines = patchSourceLines(patch);
  if (!lines.length || lines.some((line) => /<\/?(?:script|style|template)\b/iu.test(line))) {
    return undefined;
  }
  if (lines.some(isScriptLikeLine)) return 'typescript';
  if (lines.some(isStyleLikeLine)) return 'css';
  return undefined;
}

function patchSourceLines(patch: string): string[] {
  return patch.split(/\r?\n/u).flatMap((line) => {
    if (!/^[- +]/u.test(line) || /^(?:---|\+\+\+)\s/u.test(line)) return [];
    return [line.slice(1)];
  });
}

function isScriptLikeLine(line: string): boolean {
  return /^\s*(?:(?:import|export)\b|(?:const|let|var|function|class|interface|type|enum|namespace|declare|return|throw)\b|(?:if|for|while|switch|try|catch)\s*\(|(?:async\s+)?\([^)]*\)\s*=>)/u.test(line)
    || /\bfrom\s+['"][^'"]+['"]/u.test(line);
}

function isStyleLikeLine(line: string): boolean {
  return /^\s*(?:@(?:media|supports|layer|keyframes)\b|(?:[.#:]|[a-z])[^{}]*\{|(?:--)?[a-z][\w-]*\s*:)/iu.test(line);
}

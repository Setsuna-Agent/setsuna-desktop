import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';

/**
 * deferred 工具的本地确定性 BM25 索引(Codex 风格的 ToolSearchInfo 语义)。
 *
 * 每个具体工具独立建索引;hidden 或权限不允许的工具在进入 router 前已被过滤,
 * 组名(browser、shell、git 等)不是条目,因此永远不会作为搜索结果返回。
 */
export type DeferredToolSearchEntry = {
  name: string;
  /** name + description + schema 字段/描述 + aliases。 */
  searchText: string;
  definition: RuntimeToolDefinition;
  /** 全局 catalog 顺序,用于分数相同时的稳定排序。 */
  catalogOrder: number;
};

export type DeferredToolSearchResult = {
  name: string;
  description: string;
};

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const SEARCH_TOKEN_RUNS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{M}\p{N}]+/gu;
const CJK_TOKEN_RUN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;

/** 默认、最大返回的具体工具数量。 */
export const TOOL_SEARCH_MAX_RESULTS = 8;

export class DeferredToolSearchIndex {
  private readonly docs: { entry: DeferredToolSearchEntry; tokens: string[]; docLength: number }[];
  private readonly avgDocLength: number;
  private readonly documentFrequency = new Map<string, number>();
  private readonly exactNames = new Set<string>();

  constructor(entries: DeferredToolSearchEntry[]) {
    this.docs = entries.map((entry) => {
      const tokens = tokenize(entry.searchText);
      return { entry, tokens, docLength: tokens.length };
    });
    this.avgDocLength = this.docs.length
      ? this.docs.reduce((sum, doc) => sum + doc.docLength, 0) / this.docs.length
      : 0;
    const seenTerms = new Set<string>();
    for (const doc of this.docs) {
      for (const token of new Set(doc.tokens)) {
        if (!seenTerms.has(token)) {
          seenTerms.add(token);
          this.documentFrequency.set(token, 0);
        }
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
    }
    for (const entry of entries) this.exactNames.add(entry.name);
  }

  get size(): number {
    return this.docs.length;
  }

  entries(): DeferredToolSearchEntry[] {
    return this.docs.map((doc) => doc.entry);
  }

  has(name: string): boolean {
    return this.exactNames.has(name);
  }

  /**
   * 返回按相关性排序的工具名。精确工具名优先;相同分数按 catalog 顺序。
   * 空查询或空词条不返回任何工具。
   */
  search(query: string, maxResults = TOOL_SEARCH_MAX_RESULTS): DeferredToolSearchResult[] {
    const trimmed = query.trim();
    if (!trimmed || !this.docs.length) return [];
    const queryTokens = [...new Set(tokenize(trimmed))];
    if (!queryTokens.length) return [];

    const exactName = this.exactNames.has(trimmed)
      ? trimmed
      : this.exactNames.has(trimmed.toLowerCase())
        ? trimmed.toLowerCase()
        : null;

    const scored = this.docs
      .map((doc): { entry: DeferredToolSearchEntry; score: number } => ({
        entry: doc.entry,
        // 精确工具名使用有限大值而非 Infinity,避免被 score>0 过滤掉。
        score: exactName === doc.entry.name ? Number.MAX_SAFE_INTEGER : this.score(doc, queryTokens),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) =>
        right.score - left.score
        || left.entry.catalogOrder - right.entry.catalogOrder)
      .slice(0, Math.max(1, Math.min(TOOL_SEARCH_MAX_RESULTS, Math.floor(maxResults))));

    return scored.map(({ entry }) => ({
      name: entry.name,
      description: entry.definition.description,
    }));
  }

  private score(
    doc: { entry: DeferredToolSearchEntry; tokens: string[]; docLength: number },
    queryTokens: string[],
  ): number {
    const termFrequency = new Map<string, number>();
    for (const token of doc.tokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }
    const docCount = this.docs.length;
    let score = 0;
    for (const token of queryTokens) {
      const tf = termFrequency.get(token) ?? 0;
      if (!tf) continue;
      const df = this.documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
      const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.docLength / (this.avgDocLength || 1)));
      score += idf * (tf * (BM25_K1 + 1)) / denominator;
    }
    return score;
  }
}

/** 从工具定义和 profile 组装可检索文本。 */
export function buildDeferredToolSearchText(
  tool: RuntimeToolDefinition,
  aliases: string[] | undefined,
): string {
  const schemaTerms = schemaSearchTerms(tool.inputSchema);
  return [
    tool.name,
    tool.description,
    ...schemaTerms,
    ...(aliases ?? []),
  ].filter(Boolean).join(' ');
}

function schemaSearchTerms(schema: Record<string, unknown>, depth = 0): string[] {
  if (depth > 3) return [];
  const terms: string[] = [];
  if (!schema || typeof schema !== 'object') return terms;
  const record = schema as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === 'properties' && value && typeof value === 'object') {
      for (const [propertyName, property] of Object.entries(value as Record<string, unknown>)) {
        terms.push(propertyName);
        if (property && typeof property === 'object') {
          const description = (property as Record<string, unknown>).description;
          if (typeof description === 'string') terms.push(description);
          terms.push(...schemaSearchTerms(property as Record<string, unknown>, depth + 1));
        }
      }
      continue;
    }
    if (typeof value === 'string' && key !== 'type' && key !== 'additionalProperties') {
      terms.push(value);
    }
  }
  return terms;
}

function tokenize(text: string): string[] {
  const runs = text.normalize('NFKC').toLowerCase().match(SEARCH_TOKEN_RUNS) ?? [];
  return runs.flatMap((run) => CJK_TOKEN_RUN.test(run) ? cjkSearchTokens(run) : [run]);
}

/** CJK 没有稳定空格边界；保留整段并追加 bigram，支持在较长本地化描述中命中短语。 */
function cjkSearchTokens(run: string): string[] {
  const characters = [...run];
  if (characters.length < 3) return [run];
  return [
    run,
    ...characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`),
  ];
}

export type WebSearchTopic = 'general' | 'news' | 'finance';
export type WebSearchTimeRange = 'day' | 'week' | 'month' | 'year';

export type WebSearchRequest = {
  query: string;
  maxResults: number;
  topic?: WebSearchTopic;
  timeRange?: WebSearchTimeRange;
  includeDomains?: string[];
  excludeDomains?: string[];
  signal?: AbortSignal;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  publishedDate?: string;
};

export type WebSearchResponse = {
  provider: 'tavily-keyless';
  query: string;
  results: WebSearchResult[];
};

export type WebSearchClient = {
  search(request: WebSearchRequest): Promise<WebSearchResponse>;
};

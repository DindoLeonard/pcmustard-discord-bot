import type { z } from "zod";

export interface AIRequest<T> {
  /** Short label for logs, e.g. "counter.explain". */
  task: string;
  system: string;
  user: string;
  /** Output must match this schema; providers request structured output and the service re-validates. */
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens?: number;
}

export interface AIResponse<T> {
  data: T;
  provider: string;
  model: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** A free-text answer researched on the web. Used only for questions our own data can't answer. */
export interface WebSearchRequest {
  task: string;
  system: string;
  user: string;
  maxOutputTokens?: number;
}

export interface WebSource {
  title: string;
  url: string;
}

export interface WebSearchResponse {
  /** Answer text with inline citation links removed (sources are returned separately). */
  text: string;
  sources: WebSource[];
  /** Search queries the model ran (for logs). */
  queries: string[];
  provider: string;
  model: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generateResponse<T>(input: AIRequest<T>): Promise<AIResponse<T>>;
  /** Optional: providers without a web search tool leave this undefined. */
  searchWeb?(input: WebSearchRequest): Promise<WebSearchResponse>;
}

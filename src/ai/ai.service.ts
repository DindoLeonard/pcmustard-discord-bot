import { env } from "../config/env.js";
import { AIUnavailableError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import { OpenAIProvider } from "./providers/openai.provider.js";
import type { AIProvider, AIRequest, AIResponse, WebSearchRequest, WebSearchResponse } from "./types.js";

export type AIResult<T> = { ok: true; data: T; model: string; latencyMs: number } | { ok: false; error: string };

export class AIService {
  constructor(
    private readonly provider: AIProvider | null,
    private readonly webSearchEnabled = true,
  ) {}

  get available(): boolean {
    return this.provider !== null;
  }

  /** True when the provider supports web search and it hasn't been switched off. */
  get webSearchAvailable(): boolean {
    return this.webSearchEnabled && typeof this.provider?.searchWeb === "function";
  }

  get model(): string | null {
    return this.provider ? `${this.provider.name}/${this.provider.model}` : null;
  }

  async generate<T>(request: AIRequest<T>): Promise<AIResponse<T>> {
    if (!this.provider) throw new AIUnavailableError("no AI provider configured (set OPENAI_API_KEY)");
    const started = Date.now();
    try {
      const res = await this.provider.generateResponse(request);
      logger.info("ai request", {
        task: request.task,
        provider: res.provider,
        model: res.model,
        latencyMs: res.latencyMs,
        inputTokens: res.usage?.inputTokens,
        outputTokens: res.usage?.outputTokens,
      });
      return res;
    } catch (err) {
      logger.warn("ai request failed", { task: request.task, provider: this.provider.name, latencyMs: Date.now() - started, error: err });
      throw err instanceof AIUnavailableError ? err : new AIUnavailableError("unexpected error", err);
    }
  }

  /** Never throws: callers fall back to the data-only response on failure. */
  async tryGenerate<T>(request: AIRequest<T>): Promise<AIResult<T>> {
    try {
      const res = await this.generate(request);
      return { ok: true, data: res.data, model: res.model, latencyMs: res.latencyMs };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Web-researched answer, or an error result. Never throws. */
  async trySearchWeb(request: WebSearchRequest): Promise<{ ok: true; data: WebSearchResponse } | { ok: false; error: string }> {
    if (!this.provider?.searchWeb || !this.webSearchEnabled) return { ok: false, error: "web search unavailable" };
    const started = Date.now();
    try {
      const res = await this.provider.searchWeb(request);
      logger.info("web search", {
        task: request.task,
        provider: res.provider,
        model: res.model,
        latencyMs: res.latencyMs,
        queries: res.queries,
        sources: res.sources.map((s) => new URL(s.url).hostname),
        inputTokens: res.usage?.inputTokens,
        outputTokens: res.usage?.outputTokens,
      });
      return { ok: true, data: res };
    } catch (err) {
      logger.warn("web search failed", { task: request.task, latencyMs: Date.now() - started, error: err });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export function createAIService(): AIService {
  if (!env.OPENAI_API_KEY) return new AIService(null);
  return new AIService(
    new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      reasoningEffort: env.OPENAI_REASONING_EFFORT,
      timeoutMs: env.AI_TIMEOUT_MS,
      searchModel: env.WEB_SEARCH_MODEL,
      searchTimeoutMs: env.WEB_SEARCH_TIMEOUT_MS,
    }),
    env.WEB_SEARCH_ENABLED,
  );
}

export const ai = createAIService();

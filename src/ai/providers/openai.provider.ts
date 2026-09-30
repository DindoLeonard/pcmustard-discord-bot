import { z } from "zod";
import { AIUnavailableError } from "../../shared/errors.js";
import type { AIProvider, AIRequest, AIResponse, WebSearchRequest, WebSearchResponse, WebSource } from "../types.js";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
  /** Model for web search (defaults to `model`). */
  searchModel?: string;
  /** Searches take longer than plain completions. */
  searchTimeoutMs?: number;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

interface ChatCompletionResponse {
  model: string;
  choices: { message: { content: string | null; refusal?: string | null }; finish_reason: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message: string; code?: string };
}

/** Reasoning models (gpt-5*, o-series) accept reasoning_effort; older chat models reject it. */
function supportsReasoningEffort(model: string): boolean {
  return /^(gpt-5|gpt-6|o\d)/.test(model);
}

/** OpenAI's 401 message echoes (part of) the key; never let that reach logs. */
export function redactKeys(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_*.\-]+/g, "sk-[redacted]");
}

/** zod -> JSON Schema in the shape OpenAI strict structured outputs accepts. */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

interface ResponsesApiResponse {
  model?: string;
  output?: {
    type: string;
    action?: { query?: string; queries?: string[] };
    content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string; start_index?: number; end_index?: number }[] }[];
  }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message: string };
}

/** Drop tracking params like ?utm_source=openai so links are clean. */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * The model cites inline like "... mead too. ([site.wiki](https://...))". We list sources separately,
 * so remove the cited spans (by annotation index, then any leftover "([x](http..))" patterns) and tidy spacing.
 */
export function stripInlineCitations(text: string, spans: { start: number; end: number }[]): string {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    if (s.start >= 0 && s.end <= out.length && s.end > s.start) out = out.slice(0, s.start) + out.slice(s.end);
  }
  return out
    .replace(/\s*\(\s*\[[^\]]*\]\(https?:\/\/[^)\s]+\)\s*\)/g, "")
    .replace(/\s*\(\s*\)/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly reasoningEffort?: ReasoningEffort;
  private readonly timeoutMs: number;
  private readonly searchModel: string;
  private readonly searchTimeoutMs: number;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAIProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort;
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.searchModel = options.searchModel ?? options.model;
    this.searchTimeoutMs = options.searchTimeoutMs ?? 45_000;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async generateResponse<T>(input: AIRequest<T>): Promise<AIResponse<T>> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: input.model ?? this.model,
      messages: [
        { role: "system", content: input.system },
        {
          role: "user",
          content: input.images?.length
            ? [
                { type: "text", text: input.user },
                ...input.images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl, detail: img.detail ?? "auto" } })),
              ]
            : input.user,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: input.schemaName, strict: true, schema: toStrictJsonSchema(input.schema) },
      },
    };
    if (input.maxOutputTokens) body.max_completion_tokens = input.maxOutputTokens;
    if (this.reasoningEffort && supportsReasoningEffort(input.model ?? this.model)) body.reasoning_effort = this.reasoningEffort;

    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "TimeoutError" ? `timed out after ${this.timeoutMs}ms` : "request failed";
      throw new AIUnavailableError(reason, err);
    }

    const json = (await res.json().catch(() => ({}))) as ChatCompletionResponse;
    if (!res.ok) throw new AIUnavailableError(`HTTP ${res.status}: ${redactKeys(json.error?.message ?? "unknown error")}`);

    const choice = json.choices?.[0];
    if (!choice) throw new AIUnavailableError("empty response");
    if (choice.message.refusal) throw new AIUnavailableError(`model refused: ${choice.message.refusal}`);
    if (choice.finish_reason === "length") throw new AIUnavailableError("response truncated (max tokens)");

    let parsed: unknown;
    try {
      parsed = JSON.parse(choice.message.content ?? "");
    } catch (err) {
      throw new AIUnavailableError("response was not valid JSON", err);
    }
    const validated = input.schema.safeParse(parsed);
    if (!validated.success) throw new AIUnavailableError(`response failed schema validation: ${validated.error.message}`);

    return {
      data: validated.data,
      provider: this.name,
      model: json.model ?? this.model,
      latencyMs: Date.now() - started,
      usage: { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens },
    };
  }

  /** Responses API with the web_search tool, forced on (otherwise the model often answers from memory). */
  async searchWeb(input: WebSearchRequest): Promise<WebSearchResponse> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: this.searchModel,
      tools: [{ type: "web_search" }],
      tool_choice: "required",
      instructions: input.system,
      input: input.user,
    };
    if (input.maxOutputTokens) body.max_output_tokens = input.maxOutputTokens;
    if (this.reasoningEffort && supportsReasoningEffort(this.searchModel)) {
      // Web search needs at least "low" reasoning on gpt-5 models.
      body.reasoning = { effort: this.reasoningEffort === "none" || this.reasoningEffort === "minimal" ? "low" : this.reasoningEffort };
    }

    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.searchTimeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "TimeoutError" ? `web search timed out after ${this.searchTimeoutMs}ms` : "web search request failed";
      throw new AIUnavailableError(reason, err);
    }
    const json = (await res.json().catch(() => ({}))) as ResponsesApiResponse;
    if (!res.ok) throw new AIUnavailableError(`HTTP ${res.status}: ${redactKeys(json.error?.message ?? "unknown error")}`);

    const queries: string[] = [];
    const sources: WebSource[] = [];
    const parts: string[] = [];
    for (const item of json.output ?? []) {
      if (item.type === "web_search_call") queries.push(...(item.action?.queries ?? (item.action?.query ? [item.action.query] : [])));
      if (item.type !== "message") continue;
      for (const c of item.content ?? []) {
        if (c.type !== "output_text" || !c.text) continue;
        const cites = (c.annotations ?? []).filter((a) => a.type === "url_citation" && a.url);
        for (const a of cites) {
          const url = cleanUrl(a.url!);
          if (!sources.some((s) => s.url === url)) sources.push({ title: a.title?.trim() || new URL(url).hostname, url });
        }
        parts.push(stripInlineCitations(c.text, cites.map((a) => ({ start: a.start_index ?? -1, end: a.end_index ?? -1 }))));
      }
    }
    const text = parts.join("\n\n").trim();
    if (!text) throw new AIUnavailableError("web search returned no answer");

    return {
      text,
      sources,
      queries: [...new Set(queries)],
      provider: this.name,
      model: json.model ?? this.searchModel,
      latencyMs: Date.now() - started,
      usage: { inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens },
    };
  }
}

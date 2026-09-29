import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { counterExplanationSchema } from "../src/ai/prompts/counter.prompt.js";
import { draftExplanationSchema, whyNotSchema } from "../src/ai/prompts/draft.prompt.js";
import { chatReplySchema } from "../src/ai/prompts/chat.prompt.js";
import { heroExplanationSchema, heroGuessSchema } from "../src/ai/prompts/general.prompt.js";
import { intentSchema } from "../src/ai/prompts/intent.prompt.js";
import { matchupExplanationSchema } from "../src/ai/prompts/matchup.prompt.js";
import { OpenAIProvider, redactKeys, toStrictJsonSchema } from "../src/ai/providers/openai.provider.js";
import { AIUnavailableError } from "../src/shared/errors.js";

const SCHEMAS: Record<string, z.ZodType> = {
  counter: counterExplanationSchema,
  matchup: matchupExplanationSchema,
  draft: draftExplanationSchema,
  whyNot: whyNotSchema,
  hero: heroExplanationSchema,
  chat: chatReplySchema,
  intent: intentSchema,
  guess: heroGuessSchema(["Puck", "Zeus"]),
};

/** OpenAI strict mode: every object must list all properties as required and forbid extras. */
function assertStrict(node: unknown, path: string): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (n.type === "object") {
    expect(n.additionalProperties, `${path} additionalProperties`).toBe(false);
    expect([...(n.required as string[])].sort(), `${path} required`).toEqual(Object.keys(n.properties as object).sort());
  }
  for (const [k, v] of Object.entries(n)) {
    if (Array.isArray(v)) v.forEach((x, i) => assertStrict(x, `${path}.${k}[${i}]`));
    else assertStrict(v, `${path}.${k}`);
  }
}

describe("AI output schemas", () => {
  it.each(Object.entries(SCHEMAS))("%s schema is valid for OpenAI strict mode", (name, schema) => {
    const json = toStrictJsonSchema(schema);
    expect(json.$schema).toBeUndefined();
    assertStrict(json, name);
  });

  it("hero guesses are constrained to real hero names", () => {
    const schema = heroGuessSchema(["Puck", "Zeus"]);
    expect(schema.safeParse({ matches: ["Puck"] }).success).toBe(true);
    expect(schema.safeParse({ matches: ["Pudgey"] }).success).toBe(false);
  });
});

function completion(content: unknown, extra: Record<string, unknown> = {}) {
  return Response.json({
    model: "gpt-test",
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    ...extra,
  });
}

const request = {
  task: "test",
  schemaName: "chat_reply",
  schema: chatReplySchema,
  system: "s",
  user: "u",
};

describe("OpenAIProvider", () => {
  it("sends a strict json_schema request and parses the result", async () => {
    const fetchFn = vi.fn(async () => completion({ reply: "a" }));
    const provider = new OpenAIProvider({ apiKey: "k", model: "gpt-5.4-mini", reasoningEffort: "low", fetchFn: fetchFn as typeof fetch });
    const res = await provider.generateResponse(request);
    expect(res.data).toEqual({ reply: "a" });
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });

    const body = JSON.parse(String((fetchFn.mock.calls[0] as unknown as [unknown, RequestInit])[1].body));
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.reasoning_effort).toBe("low");
  });

  it("omits reasoning_effort for non-reasoning models", async () => {
    const fetchFn = vi.fn(async () => completion({ reply: "a" }));
    await new OpenAIProvider({ apiKey: "k", model: "gpt-4.1-mini", reasoningEffort: "low", fetchFn: fetchFn as typeof fetch }).generateResponse(request);
    const body = JSON.parse(String((fetchFn.mock.calls[0] as unknown as [unknown, RequestInit])[1].body));
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("rejects output that doesn't match the schema", async () => {
    const provider = new OpenAIProvider({ apiKey: "k", model: "m", fetchFn: (async () => completion({ reply: 5 })) as typeof fetch });
    await expect(provider.generateResponse(request)).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it("rejects truncated and non-JSON output", async () => {
    const truncated = new OpenAIProvider({
      apiKey: "k",
      model: "m",
      fetchFn: (async () => Response.json({ choices: [{ message: { content: "{" }, finish_reason: "length" }] })) as typeof fetch,
    });
    await expect(truncated.generateResponse(request)).rejects.toThrow(/truncated/);
    const garbage = new OpenAIProvider({ apiKey: "k", model: "m", fetchFn: (async () => completion("not json")) as typeof fetch });
    await expect(garbage.generateResponse(request)).rejects.toThrow(/not valid JSON/);
  });

  it("redacts API keys from HTTP errors", async () => {
    const provider = new OpenAIProvider({
      apiKey: "k",
      model: "m",
      fetchFn: (async () => Response.json({ error: { message: "Incorrect API key provided: sk-proj-abc*****xyz." } }, { status: 401 })) as typeof fetch,
    });
    const err = (await provider.generateResponse(request).catch((e: Error) => e)) as Error;
    expect(err.message).toContain("HTTP 401");
    expect(err.message).not.toContain("abc");
    expect(redactKeys("key sk-12_3-x ok")).toBe("key sk-[redacted] ok");
  });
});

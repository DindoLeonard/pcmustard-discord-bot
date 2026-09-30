import { describe, expect, it, vi } from "vitest";
import { AIService } from "../src/ai/ai.service.js";
import type { ParsedIntent } from "../src/ai/prompts/intent.prompt.js";
import { OpenAIProvider, cleanUrl, stripInlineCitations } from "../src/ai/providers/openai.provider.js";
import type { AIProvider, AIRequest, AIResponse, WebSearchRequest, WebSearchResponse } from "../src/ai/types.js";
import { AskService } from "../src/assistant/ask.service.js";
import { DotaAssistant } from "../src/assistant/dota.assistant.js";
import { renderAsk, withSources } from "../src/discord/components/ask.render.js";
import { DotaAdapter } from "../src/games/dota/dota.adapter.js";
import { AIUnavailableError } from "../src/shared/errors.js";
import { FakeDotaProvider } from "./fixtures.js";

const TEXT = "For the Swamp, use **Root armor**. Bring poison mead too. ([valheimwiki.wiki](https://www.valheimwiki.wiki/en/armor/?utm_source=openai))";
const CITED = "([valheimwiki.wiki](https://www.valheimwiki.wiki/en/armor/?utm_source=openai))";

function responsesApi(overrides: Record<string, unknown> = {}) {
  return Response.json({
    model: "gpt-test",
    output: [
      { type: "reasoning" },
      { type: "web_search_call", status: "completed", action: { type: "search", queries: ["valheim swamp armor"] } },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: TEXT,
            annotations: [
              {
                type: "url_citation",
                url: "https://www.valheimwiki.wiki/en/armor/?utm_source=openai",
                title: "Armor | Valheim Wiki",
                start_index: TEXT.indexOf(CITED) + 1,
                end_index: TEXT.indexOf(CITED) + CITED.length - 1,
              },
            ],
          },
        ],
      },
    ],
    usage: { input_tokens: 100, output_tokens: 20 },
    ...overrides,
  });
}

const req: WebSearchRequest = { task: "web.other_game", system: "s", user: "u" };

describe("OpenAIProvider.searchWeb", () => {
  it("forces a web search and returns clean text with separate sources", async () => {
    const fetchFn = vi.fn(async () => responsesApi());
    const provider = new OpenAIProvider({ apiKey: "k", model: "gpt-5.4-mini", reasoningEffort: "none", fetchFn: fetchFn as typeof fetch });
    const res = await provider.searchWeb(req);

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/responses$/);
    const body = JSON.parse(String(init.body));
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.tool_choice).toBe("required");
    expect(body.reasoning).toEqual({ effort: "low" }); // "none" is bumped: search needs reasoning

    expect(res.text).toBe("For the Swamp, use **Root armor**. Bring poison mead too.");
    expect(res.sources).toEqual([{ title: "Armor | Valheim Wiki", url: "https://www.valheimwiki.wiki/en/armor/" }]);
    expect(res.queries).toEqual(["valheim swamp armor"]);
  });

  it("uses a separate search model when configured", async () => {
    const fetchFn = vi.fn(async () => responsesApi());
    await new OpenAIProvider({ apiKey: "k", model: "a", searchModel: "b", fetchFn: fetchFn as typeof fetch }).searchWeb(req);
    expect(JSON.parse(String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body)).model).toBe("b");
  });

  it("errors on empty answers and redacts keys from HTTP errors", async () => {
    const empty = new OpenAIProvider({ apiKey: "k", model: "m", fetchFn: (async () => responsesApi({ output: [] })) as typeof fetch });
    await expect(empty.searchWeb(req)).rejects.toThrow(/no answer/);
    const denied = new OpenAIProvider({
      apiKey: "k",
      model: "m",
      fetchFn: (async () => Response.json({ error: { message: "bad key sk-proj-123abc" } }, { status: 401 })) as typeof fetch,
    });
    const err = (await denied.searchWeb(req).catch((e: Error) => e)) as Error;
    expect(err).toBeInstanceOf(AIUnavailableError);
    expect(err.message).not.toContain("123abc");
  });
});

describe("citation helpers", () => {
  it("removes inline citation links and tidies spacing", () => {
    expect(stripInlineCitations("Use Root armor. ([wiki](https://x.io/a))", [])).toBe("Use Root armor.");
    expect(stripInlineCitations("A ([w](https://x.io)) and B.", [])).toBe("A and B.");
  });

  it("strips utm tracking params only", () => {
    expect(cleanUrl("https://x.io/a?utm_source=openai&page=2")).toBe("https://x.io/a?page=2");
    expect(cleanUrl("not a url")).toBe("not a url");
  });

  it("formats sources as small, non-embedding links within Discord's limit", () => {
    const sources = [
      { title: "Armor [Wiki]", url: "https://x.io/a" },
      { title: "", url: "https://y.io/b" },
    ];
    expect(withSources("Hi", sources)).toBe("Hi\n-# Sources: [Armor Wiki](<https://x.io/a>) · [y.io](<https://y.io/b>)");
    expect(withSources("Hi", [])).toBe("Hi");
    const long = "x".repeat(1990);
    expect(withSources(long, sources)).toBe(long); // no room: drop sources rather than exceed 2000
  });
});

/** Fake provider with web search; `search` may be an Error to simulate failure. */
class FakeSearchAI implements AIProvider {
  readonly name = "fake";
  readonly model = "fake-1";
  calls: string[] = [];
  constructor(private readonly search: WebSearchResponse | Error) {}
  async generateResponse<T>(input: AIRequest<T>): Promise<AIResponse<T>> {
    this.calls.push(input.task);
    return { data: input.schema.parse({ reply: "From memory: use Root armor." }), provider: "fake", model: "fake-1", latencyMs: 1 };
  }
  async searchWeb(input: WebSearchRequest): Promise<WebSearchResponse> {
    this.calls.push(input.task);
    if (this.search instanceof Error) throw this.search;
    return this.search;
  }
}

const OTHER_GAME: ParsedIntent = {
  game: "other",
  intent: "other_game",
  hero: null,
  enemy: null,
  position: null,
  allies: [],
  enemies: [],
  removed: [],
  players: [],
  matchId: null,
  bracket: null,
  image: null,
  continuesDraft: false,
};

function service(search: WebSearchResponse | Error, enabled = true) {
  const fake = new FakeSearchAI(search);
  const ai = new AIService(fake, enabled);
  const dota = new DotaAdapter(new FakeDotaProvider());
  return { fake, svc: new AskService(new DotaAssistant(dota, ai), ai, async (q) => (await dota.heroes.resolve(q)).hero) };
}

const FOUND: WebSearchResponse = {
  text: "Use **Root armor** in the Swamp.",
  sources: [
    { title: "A", url: "https://a.io" },
    { title: "B", url: "https://b.io" },
    { title: "C", url: "https://c.io" },
    { title: "D", url: "https://d.io" },
  ],
  queries: ["q"],
  provider: "fake",
  model: "fake-1",
  latencyMs: 1,
};

describe("web answers in chat", () => {
  it("answers other-game questions from a web search, with up to 3 sources and no button", async () => {
    const { svc, fake } = service(FOUND);
    const res = await svc.answer("valheim swamp armor?", OTHER_GAME, [], "Leo");
    expect(fake.calls).toEqual(["web.other_game"]);
    const payload = renderAsk(res);
    expect(payload.content).toBe("Use **Root armor** in the Swamp.\n-# Sources: [A](<https://a.io>) · [B](<https://b.io>) · [C](<https://c.io>)");
    expect(payload.components).toHaveLength(0);
  });

  it("falls back to general knowledge, clearly labelled, when search fails or is disabled", async () => {
    for (const [search, enabled] of [[new AIUnavailableError("down"), true], [FOUND, false]] as const) {
      const { svc, fake } = service(search, enabled);
      const res = await svc.answer("valheim swamp armor?", OTHER_GAME);
      expect(renderAsk(res).content).toMatch(/^From memory: use Root armor\.\n-# I couldn't search the web/);
      expect(fake.calls).toContain("chat.reply");
    }
  });

  it("routes everyday lookups (hours, weather) to web search", async () => {
    const { svc, fake } = service(FOUND);
    const lookup = { ...OTHER_GAME, game: "dota2" as const, intent: "web_lookup" as const };
    expect(await svc.plan(lookup)).toMatchObject({ request: { kind: "web", topic: "general" } });
    await svc.answer("what time does anytime fitness escario close?", lookup);
    expect(fake.calls).toEqual(["web.general"]);
  });

  it("says so when a web answer came back without source links", async () => {
    const { svc } = service({ ...FOUND, sources: [] });
    const res = await svc.answer("weather in cebu?", { ...OTHER_GAME, game: "dota2", intent: "web_lookup" });
    expect(renderAsk(res).content).toMatch(/\n-# Found with a web search, but no source links came back/);
  });

  it("tells the chat model truthfully whether it can search", async () => {
    const { chatPrompt } = await import("../src/ai/prompts/chat.prompt.js");
    expect(chatPrompt({ question: "can you search?", data: "", webSearchAvailable: true }).system).toMatch(/you CAN search the web/);
    expect(chatPrompt({ question: "can you search?", data: "", webSearchAvailable: false }).system).toMatch(/web search is currently switched off/);
    expect(chatPrompt({ question: "x", data: "" }).system).not.toContain("{{CAPABILITIES}}");
  });

  it("reports availability", () => {
    expect(new AIService(new FakeSearchAI(FOUND), true).webSearchAvailable).toBe(true);
    expect(new AIService(new FakeSearchAI(FOUND), false).webSearchAvailable).toBe(false);
    expect(new AIService(null).webSearchAvailable).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import { AIService } from "../src/ai/ai.service.js";
import { chatPrompt } from "../src/ai/prompts/chat.prompt.js";
import { draftScreenshotSchema } from "../src/ai/prompts/image.prompt.js";
import { intentPrompt, type ParsedIntent } from "../src/ai/prompts/intent.prompt.js";
import { OpenAIProvider } from "../src/ai/providers/openai.provider.js";
import type { AIImage, AIProvider, AIRequest, AIResponse } from "../src/ai/types.js";
import { AskService, applyScreenshot, imageBlock, screenshotNote } from "../src/assistant/ask.service.js";
import { DotaAssistant } from "../src/assistant/dota.assistant.js";
import { MAX_IMAGE_BYTES, MAX_IMAGES, downloadImages } from "../src/discord/attachments.js";
import { renderAsk } from "../src/discord/components/ask.render.js";
import { DotaAdapter } from "../src/games/dota/dota.adapter.js";
import { FakeDotaProvider } from "./fixtures.js";

const IMG: AIImage = { dataUrl: "data:image/png;base64,AAAA", detail: "high" };

const baseIntent = (over: Partial<ParsedIntent> = {}): ParsedIntent => ({
  game: "dota2",
  intent: "general_strategy",
  hero: null,
  enemy: null,
  position: null,
  allies: [],
  enemies: [],
  removed: [],
  players: [],
  matchId: null,
  bracket: null,
  continuesDraft: false,
  image: null,
  ...over,
});

const draftImage = (askerSide: "radiant" | "dire" | "unknown" = "unknown") => ({
  kind: "dota_draft" as const,
  description: "A Dota 2 pick screen",
  visibleText: "",
  radiant: ["Invoker", "Zeus"],
  dire: ["Storm Spirit", "Puck", "Huskar"],
  askerSide,
});

describe("downloading attachments", () => {
  const png = (name: string, size = 10, contentType: string | null = "image/png") => ({ url: `https://cdn/${name}`, name, size, contentType });

  it("keeps up to 3 real images and inlines them as data URLs", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const out = await downloadImages(
      [png("a.png"), png("notes.txt", 10, "text/plain"), png("big.png", MAX_IMAGE_BYTES + 1), png("b.png"), png("c.jpg", 10, null), png("d.png")],
      fetchFn as typeof fetch,
    );
    expect(out).toHaveLength(MAX_IMAGES);
    expect(out[0]).toEqual({ dataUrl: "data:image/png;base64,AQID", detail: "high" });
    expect(out[2]!.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true); // inferred from extension
    expect(fetchFn).toHaveBeenCalledTimes(3); // text file and oversized image never downloaded
  });

  it("skips images that fail to download", async () => {
    const out = await downloadImages([png("a.png")], (async () => new Response("nope", { status: 403 })) as typeof fetch);
    expect(out).toEqual([]);
  });
});

describe("OpenAI requests with images", () => {
  it("sends images as image_url parts next to the text, and honours a per-request model", async () => {
    const fetchFn = vi.fn(async () => Response.json({ model: "m", choices: [{ message: { content: JSON.stringify({ reply: "ok" }) }, finish_reason: "stop" }] }));
    const provider = new OpenAIProvider({ apiKey: "k", model: "gpt-5.4-mini", fetchFn: fetchFn as typeof fetch });
    await provider.generateResponse({ ...chatPrompt({ question: "q", data: "" }), images: [IMG], model: "gpt-5.4" });
    const body = JSON.parse(String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe("gpt-5.4");
    expect(body.messages[1].content).toEqual([
      { type: "text", text: expect.any(String) },
      { type: "image_url", image_url: { url: IMG.dataUrl, detail: "high" } },
    ]);
  });
});

describe("prompts", () => {
  it("asks the parser to describe images only when there are some", () => {
    const withImg = intentPrompt("what's this", "", [IMG], "Leo");
    expect(withImg.images).toHaveLength(1);
    expect(withImg.system).toMatch(/IMAGES are attached/);
    expect(withImg.user).toMatch(/ASKER'S NAME: Leo/);
    const none = intentPrompt("hi");
    expect(none.system).toMatch(/set "image" to null/);
    expect(intentPrompt("", "", [IMG]).user).toMatch(/no text, just the attached image/);
  });

  it("constrains screenshot heroes to real names", () => {
    const schema = draftScreenshotSchema(["Puck", "Zeus"]);
    expect(schema.safeParse({ radiant: ["Puck"], dire: [], askerSide: "unknown" }).success).toBe(true);
    expect(schema.safeParse({ radiant: ["Pukc"], dire: [], askerSide: "unknown" }).success).toBe(false);
  });

  it("tells the chat model it can see images, and to say so when none is attached", () => {
    expect(chatPrompt({ question: "q", data: "" }).system).toMatch(/You CAN see images/);
    expect(chatPrompt({ question: "q", data: "" }).system).toMatch(/say you don't see one/);
  });
});

describe("screenshot helpers", () => {
  it("maps the asker's side to allies/enemies, leaving the open slot when still picking", () => {
    const pick = applyScreenshot(baseIntent({ intent: "pick_recommendation", image: draftImage() }), "dire");
    expect(pick).toMatchObject({ intent: "pick_recommendation", allies: ["Storm Spirit", "Puck", "Huskar"], enemies: ["Invoker", "Zeus"], continuesDraft: false });
    const five = { ...draftImage(), dire: ["Storm Spirit", "Puck", "Huskar", "Zeus", "Invoker"], radiant: [] };
    expect(applyScreenshot(baseIntent({ intent: "pick_recommendation", image: five }), "dire").allies).toHaveLength(4);
    expect(applyScreenshot(baseIntent({ intent: "general_strategy", image: five }), "dire")).toMatchObject({ intent: "draft_analysis", allies: five.dire });
  });

  it("describes the image for the chat reply and shows what was read", () => {
    const i = baseIntent({ image: { ...draftImage("radiant"), visibleText: "ALL PICK 0:24" } });
    expect(imageBlock(i)).toMatch(/IMAGE ATTACHED BY THE ASKER \(dota draft\): A Dota 2 pick screen/);
    expect(imageBlock(i)).toMatch(/Text in the image: ALL PICK 0:24/);
    expect(screenshotNote(i)).toMatch(/Radiant Invoker, Zeus · Dire Storm Spirit, Puck, Huskar/);
    expect(imageBlock(baseIntent())).toBe("");
  });
});

/** Parser + vision + chat, all canned. `read` is what the vision model "sees". */
class FakeVisionAI implements AIProvider {
  readonly name = "fake";
  readonly model = "fake-mini";
  prompts: AIRequest<unknown>[] = [];
  constructor(
    private readonly parsed: ParsedIntent,
    private readonly read: { radiant: string[]; dire: string[]; askerSide: string },
  ) {}
  async generateResponse<T>(input: AIRequest<T>): Promise<AIResponse<T>> {
    this.prompts.push(input as AIRequest<unknown>);
    const data = input.task === "intent.parse" ? this.parsed : input.task === "image.draft" ? this.read : { reply: "Pick Disruptor." };
    return { data: input.schema.parse(data), provider: this.name, model: input.model ?? this.model, latencyMs: 1 };
  }
}

function service(parsed: ParsedIntent, read = { radiant: ["Invoker"], dire: ["Storm Spirit", "Puck"], askerSide: "unknown" }) {
  const fake = new FakeVisionAI(parsed, read);
  const ai = new AIService(fake);
  const dota = new DotaAdapter(new FakeDotaProvider());
  const svc = new AskService(new DotaAssistant(dota, ai), ai, async (q) => (await dota.heroes.resolve(q)).hero, undefined, undefined, undefined, "gpt-5.4");
  return { svc, fake };
}

describe("AskService with images", () => {
  const conv = { key: "g:c", author: "Leo", userId: "1" };

  it("re-reads a draft screenshot with the vision model, then asks which side when unknown", async () => {
    const { svc, fake } = service(baseIntent({ intent: "pick_recommendation", position: 5, image: draftImage() }));
    const res = await svc.ask("what pos 5?", conv, [IMG]);
    const vision = fake.prompts.find((p) => p.task === "image.draft")!;
    expect(vision.model).toBe("gpt-5.4");
    expect(vision.images?.[0]?.detail).toBe("high");
    expect(res.kind).toBe("choice");
    // The vision model's read wins over the parser's
    expect((res as { message: string }).message).toMatch(/\*\*Radiant:\*\* Invoker\n\*\*Dire:\*\* Storm Spirit, Puck/);
    const payload = renderAsk(res);
    const buttons = payload.components[0]!.toJSON().components as { custom_id: string; label: string }[];
    expect(buttons.map((b) => b.label)).toEqual(["We're Radiant", "We're Dire"]);

    // Clicking "Dire" continues with the draft (enemies = Radiant)
    const token = buttons[1]!.custom_id.split(":")[2]!;
    const after = await svc.resolveScreenshotSide(token, "dire", conv);
    expect(after).toMatchObject({ kind: "chat", request: { kind: "draft", input: { allies: ["Storm Spirit", "Puck"], enemies: ["Invoker"], position: 5 } } });
    expect(await svc.resolveScreenshotSide(token, "dire", conv)).toMatchObject({ kind: "message", message: expect.stringMatching(/expired/) });
  });

  it("goes straight to the analysis when the side is known, and shows what was read", async () => {
    const { svc } = service(baseIntent({ intent: "draft_analysis", image: draftImage() }), { radiant: ["Invoker"], dire: ["Storm Spirit", "Puck"], askerSide: "radiant" });
    const res = await svc.ask("how's our draft?", conv, [IMG]);
    expect(res).toMatchObject({ kind: "chat", request: { kind: "teams", input: { allies: ["Invoker"], enemies: ["Storm Spirit", "Puck"] } } });
    expect((res as { reply: string }).reply).toMatch(/Read from the screenshot: Radiant Invoker · Dire Storm Spirit, Puck/);
  });

  it("grounds replies about any other image in its description", async () => {
    const other = { kind: "other" as const, description: "A cat wearing a Pudge hat", visibleText: "", radiant: [], dire: [], askerSide: "unknown" as const };
    const { svc, fake } = service(baseIntent({ intent: "small_talk", image: other }));
    const res = await svc.ask("", conv, [IMG]);
    expect(res.kind).toBe("chat");
    const chat = fake.prompts.find((p) => p.task === "chat.reply")!;
    expect(chat.user).toMatch(/IMAGE ATTACHED BY THE ASKER \(other\): A cat wearing a Pudge hat/);
    expect(chat.user).toMatch(/What do you think of this image\?/);
    expect(fake.prompts.some((p) => p.task === "image.draft")).toBe(false); // vision model only for drafts
  });

  it("still gives the help text for a truly empty message", async () => {
    const { svc } = service(baseIntent());
    expect(await svc.ask("   ", conv, [])).toMatchObject({ kind: "message", message: expect.stringMatching(/Ask me things like/) });
  });
});

import { describe, expect, it } from "vitest";
import { loadDiscordEnv } from "../src/config/env.js";
import { extractQuestion } from "../src/discord/client.js";

const BOT = "100000000000000001";
const TRIGGERS = ["mustardbot"];
const q = (content: string, mentioned = false, triggers = TRIGGERS) => extractQuestion(content, mentioned, BOT, triggers);

describe("extractQuestion", () => {
  it("answers @mentions anywhere and strips the mention", () => {
    expect(q(`<@${BOT}> what counters Puck?`, true)).toBe("what counters Puck?");
    expect(q(`so <@!${BOT}> what counters Puck?`, true)).toBe("so what counters Puck?");
    expect(q(`<@${BOT}>`, true)).toBe("");
  });

  it("answers messages that start with a trigger name", () => {
    expect(q("mustardbot what counters PA?")).toBe("what counters PA?");
    expect(q("MustardBot, I'm Invoker mid vs Huskar")).toBe("I'm Invoker mid vs Huskar");
    expect(q("mustardbot: draft help")).toBe("draft help");
    expect(q("hey mustardbot what should I pick")).toBe("what should I pick");
    expect(q("  mustardbot!")).toBe("");
  });

  it("ignores the name mid-sentence, as part of another word, or when disabled", () => {
    expect(q("I love mustardbot")).toBeNull();
    expect(q("mustardbots are cool")).toBeNull();
    expect(q("what counters puck")).toBeNull();
    expect(q("mustardbot what counters PA?", false, [])).toBeNull();
  });

  it("treats trigger names literally, not as regex", () => {
    expect(q("b.t hi", false, ["b.t"])).toBe("hi");
    expect(q("bot hi", false, ["b.t"])).toBeNull();
  });
});

describe("BOT_TRIGGER_NAMES", () => {
  const base = { DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "c" };

  it("defaults to mustardbot", () => {
    expect(loadDiscordEnv(base).BOT_TRIGGER_NAMES).toEqual(["mustardbot"]);
  });

  it("parses a comma-separated, case-insensitive list and can be disabled", () => {
    expect(loadDiscordEnv({ ...base, BOT_TRIGGER_NAMES: " MustardBot, mustard " }).BOT_TRIGGER_NAMES).toEqual(["mustardbot", "mustard"]);
    expect(loadDiscordEnv({ ...base, BOT_TRIGGER_NAMES: "" }).BOT_TRIGGER_NAMES).toEqual([]);
  });
});

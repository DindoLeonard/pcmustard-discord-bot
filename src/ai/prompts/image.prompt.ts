import { z } from "zod";
import type { AIImage, AIRequest } from "../types.js";

/**
 * Read both teams from a Dota 2 draft screenshot. Runs on a stronger vision model than chat (VISION_MODEL):
 * in testing gpt-5.4 got 8-9 of 9 picks right on a mock pick screen, gpt-5.4-mini only 4-5.
 * Names are constrained to the real hero list, so the output is always a valid hero (maybe the wrong one).
 * Bans are deliberately NOT read: greyed-out portraits were misidentified (and invented) by every model tested.
 */
export function draftScreenshotSchema(heroNames: [string, ...string[]]) {
  const hero = z.enum(heroNames);
  return z.object({
    radiant: z.array(hero).describe("Heroes picked by Radiant (LEFT team), in slot order; skip empty slots"),
    dire: z.array(hero).describe("Heroes picked by Dire (RIGHT team), in slot order; skip empty slots"),
    askerSide: z.enum(["radiant", "dire", "unknown"]).describe("The asker's team, if their name appears under a portrait or the message says so; else unknown"),
  });
}

export type DraftScreenshot = { radiant: string[]; dire: string[]; askerSide: "radiant" | "dire" | "unknown" };

const SYSTEM = `You identify Dota 2 heroes from their portraits on a draft / pick screen.
- Radiant is the LEFT team, Dire is the RIGHT team. List picks in slot order and skip empty or "picking" slots.
- Look closely at each portrait's distinguishing features (face, colours, silhouette, weapon) before naming it. If a portrait is too unclear, leave it out rather than guess.
- Ignore banned (greyed-out / crossed) heroes.
- askerSide: if the asker's name (given below) appears under a portrait, that's their team. Otherwise use the message text ("we're dire"), else "unknown".`;

export function draftScreenshotPrompt(images: AIImage[], heroNames: [string, ...string[]], message: string, askerName: string | undefined, model: string): AIRequest<DraftScreenshot> {
  return {
    task: "image.draft",
    schemaName: "draft_screenshot",
    schema: draftScreenshotSchema(heroNames),
    system: SYSTEM,
    user: `ASKER'S NAME: ${askerName ?? "unknown"}\nMESSAGE: ${message.slice(0, 500) || "(none)"}\nRead both teams from the screenshot.`,
    images: images.map((i) => ({ ...i, detail: "high" })),
    maxOutputTokens: 1200,
    model,
  };
}

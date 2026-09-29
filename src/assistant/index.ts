import { ai } from "../ai/ai.service.js";
import { env } from "../config/env.js";
import { dota } from "../games/registry.js";
import { AskService } from "./ask.service.js";
import { DotaAssistant } from "./dota.assistant.js";
import { ConversationMemory } from "./memory.js";

export const assistant = new DotaAssistant(dota, ai);

export const memory = new ConversationMemory({ maxTurns: env.MEMORY_MAX_TURNS, ttlMs: env.MEMORY_TTL_MINUTES * 60 * 1000 });

export const askService = new AskService(assistant, ai, async (q) => (await dota.heroes.resolve(q)).hero, memory);

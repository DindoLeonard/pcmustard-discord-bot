import { ask, forget } from "./ask.js";
import { dotaCommand } from "./dota/index.js";
import { ping } from "./ping.js";
import type { Command } from "./types.js";

export const commands = new Map<string, Command>([ping, dotaCommand, ask, forget].map((c) => [c.data.name, c]));

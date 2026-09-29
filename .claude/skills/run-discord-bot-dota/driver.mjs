#!/usr/bin/env node
// Drives the bot's real handlers (handleInteraction / handleMessage) without a Discord connection.
// Run from the repo root with tsx (it imports the TypeScript sources directly):
//
//   npx tsx .claude/skills/run-discord-bot-dota/driver.mjs [--text] <mode> ...
//
// Modes:
//   list                                        registered slash commands as JSON (what `npm run register` sends)
//   cmd <command> [subcommand] [opt=value...]    run a chat-input command, print captured replies
//   autocomplete <command> [subcommand] <option> [text]
//                                                run autocomplete for the focused option, print choices
//   component <customId> [selectedValue...]      click a button / pick from a select menu (customIds come from a
//                                                previous reply's `components`)
//   message "<text>"                             an @mention of the bot containing <text> (natural language)
//   say "<text>"                                 a plain message, no mention (tests BOT_TRIGGER_NAMES, default
//                                                "mustardbot"); prints no responses and exits 1 when the bot ignores it
//   convo "Alice>text" "Bob>text" ...             several messages in one process (shared channel memory carries over)
//   live                                        log in to Discord with .env credentials, print bot tag, exit
//
// --text prints replies as readable text instead of JSON (embeds flattened, customIds listed).
// Output goes to stdout. The app's JSON log lines go there first (warn/error on stderr); set LOG_LEVEL=warn to hide
// them. Exit code 0 = handler replied; 1 = no reply / crash; 2 = usage error.

import { ApplicationCommandOptionType, ComponentType, InteractionType } from "discord.js";

const argv = process.argv.slice(2);
const textMode = argv.includes("--text");
const [mode, ...args] = argv.filter((a) => a !== "--text");
const BOT_USER_ID = "100000000000000001";

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(
    'usage: driver.mjs [--text] list | cmd <command> [sub] [opt=value...] | autocomplete <command> [sub] <option> [text] | component <customId> [value...] | message "<text>" | say "<text>" | convo "Author>text"... | live',
  );
  process.exit(2);
}

/** Minimal stand-in for CommandInteractionOptionResolver. */
function makeOptions({ subcommand, values, focused }) {
  const get = (name, required) => {
    if (name in values) return values[name];
    if (required) throw new TypeError(`Required option "${name}" not supplied (pass ${name}=...)`);
    return null;
  };
  const num = (n, r) => {
    const v = get(n, r);
    return v == null ? null : Number(v);
  };
  return {
    getSubcommand: (required = true) => {
      if (!subcommand && required) throw new TypeError("No subcommand supplied");
      return subcommand ?? null;
    },
    getSubcommandGroup: () => null,
    getString: (n, r) => get(n, r),
    getInteger: num,
    getNumber: num,
    getBoolean: (n, r) => (get(n, r) == null ? null : get(n, r) === "true"),
    getFocused: (full = false) =>
      full ? { name: focused?.name, value: focused?.value ?? "", type: ApplicationCommandOptionType.String, focused: true } : (focused?.value ?? ""),
  };
}

const toJSON = (x) => (x && typeof x.toJSON === "function" ? x.toJSON() : x);

function serialize(payload) {
  if (typeof payload === "string") return { content: payload };
  const out = { ...payload };
  if (payload.embeds) out.embeds = payload.embeds.map(toJSON);
  if (payload.components) out.components = payload.components.map(toJSON);
  if (payload.flags !== undefined) out.ephemeral = (Number(payload.flags) & 64) === 64;
  delete out.flags;
  delete out.allowedMentions;
  return out;
}

function makeInteraction({ type, commandName, options, componentType, customId, values }) {
  const captured = [];
  const interaction = {
    type,
    commandName,
    options,
    customId,
    values,
    componentType,
    createdTimestamp: Date.now(),
    user: { id: "0", username: "driver" },
    guildId: "driver-guild",
    channelId: "driver-channel",
    client: { ws: { ping: -1 } },
    deferred: false,
    replied: false,
    responded: false,
    ephemeral: null,
    isAutocomplete: () => type === InteractionType.ApplicationCommandAutocomplete,
    isChatInputCommand: () => type === InteractionType.ApplicationCommand,
    isButton: () => type === InteractionType.MessageComponent && componentType === ComponentType.Button,
    isStringSelectMenu: () => type === InteractionType.MessageComponent && componentType === ComponentType.StringSelect,
    async reply(payload) {
      if (this.replied || this.deferred) throw new Error("InteractionAlreadyReplied");
      this.replied = true;
      captured.push({ kind: "reply", ...serialize(payload) });
    },
    async deferReply(payload = {}) {
      if (this.replied || this.deferred) throw new Error("InteractionAlreadyReplied");
      this.deferred = true;
      this.ephemeral = (Number(payload.flags ?? 0) & 64) === 64;
      captured.push({ kind: "deferReply", ...serialize(payload) });
    },
    async editReply(payload) {
      if (!this.deferred && !this.replied) throw new Error("InteractionNotReplied");
      captured.push({ kind: "editReply", ...serialize(payload) });
    },
    async deleteReply() {
      captured.push({ kind: "deleteReply" });
    },
    async followUp(payload) {
      captured.push({ kind: "followUp", ...serialize(payload) });
    },
    async respond(choices) {
      this.responded = true;
      captured.push({ kind: "autocomplete", choices });
    },
  };
  return { interaction, captured };
}

function splitPositional(rest) {
  const positional = [];
  const values = {};
  for (const a of rest) {
    const eq = a.indexOf("=");
    if (eq > 0) values[a.slice(0, eq)] = a.slice(eq + 1);
    else positional.push(a);
  }
  return { positional, values };
}

async function runCmd(rest) {
  const { commands } = await import("../../../src/discord/commands/index.js");
  const { handleInteraction } = await import("../../../src/discord/client.js");
  const { positional, values } = splitPositional(rest);
  const [commandName, subcommand] = positional;
  if (!commandName) usage("cmd needs a command name");
  if (!commands.has(commandName)) usage(`unknown command "${commandName}" (known: ${[...commands.keys()].join(", ")})`);

  const { interaction, captured } = makeInteraction({
    type: InteractionType.ApplicationCommand,
    commandName,
    options: makeOptions({ subcommand, values }),
  });
  const started = Date.now();
  await handleInteraction(interaction);
  return { mode: "cmd", command: commandName, subcommand: subcommand ?? null, options: values, ms: Date.now() - started, responses: captured };
}

async function runAutocomplete(rest) {
  const { handleInteraction } = await import("../../../src/discord/client.js");
  const [commandName, ...others] = rest;
  if (!commandName) usage("autocomplete needs a command name");
  // Forms: <command> <sub> <option> [text]  or  <command> <option> [text] (for commands without subcommands)
  let subcommand, option, text;
  if (others.length >= 2) [subcommand, option, text = ""] = others;
  else [option, text = ""] = others;
  if (!option) usage("autocomplete needs an option name");

  const { interaction, captured } = makeInteraction({
    type: InteractionType.ApplicationCommandAutocomplete,
    commandName,
    options: makeOptions({ subcommand, values: {}, focused: { name: option, value: text } }),
  });
  await handleInteraction(interaction);
  return { mode: "autocomplete", command: commandName, subcommand: subcommand ?? null, option, text, responses: captured };
}

async function runComponent(rest) {
  const { handleInteraction } = await import("../../../src/discord/client.js");
  const [customId, ...values] = rest;
  if (!customId) usage("component needs a customId (copy it from a previous reply's components)");
  const componentType = values.length ? ComponentType.StringSelect : ComponentType.Button;
  const { interaction, captured } = makeInteraction({ type: InteractionType.MessageComponent, componentType, customId, values });
  const started = Date.now();
  await handleInteraction(interaction);
  return { mode: "component", customId, values, ms: Date.now() - started, responses: captured };
}

/** `message` = an @mention containing <text>; `say` = <text> posted as-is (tests plain-name triggers). */
// Same parsing as the real bot, but without requiring Discord credentials.
const triggerNames = () => (process.env.BOT_TRIGGER_NAMES ?? "mustardbot").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Post one message into the fake channel "driver-guild:driver-channel" as `author`. */
async function postMessage(text, { mention, author = "driver" }) {
  const { handleMessage } = await import("../../../src/discord/client.js");
  const captured = [];
  const message = {
    content: mention ? `<@${BOT_USER_ID}> ${text}` : text,
    guildId: "driver-guild",
    channelId: "driver-channel",
    author: { id: `user-${author}`, bot: false, username: author, globalName: author },
    member: { displayName: author },
    mentions: { users: new Map(mention ? [[BOT_USER_ID, { id: BOT_USER_ID }]] : []) },
    channel: {
      async sendTyping() {
        captured.push({ kind: "typing" });
      },
    },
    async reply(payload) {
      captured.push({ kind: "messageReply", ...serialize(payload) });
    },
  };
  const started = Date.now();
  await handleMessage(message, BOT_USER_ID, triggerNames());
  return { ms: Date.now() - started, responses: captured };
}

/** `message` = an @mention containing <text>; `say` = <text> posted as-is (tests plain-name triggers). */
async function runMessage(rest, { mention = true } = {}) {
  const text = rest.join(" ");
  const res = await postMessage(text, { mention });
  return { mode: mention ? "message" : "say", text, triggerNames: triggerNames(), ...res };
}

/**
 * Several messages in one process, so the shared channel memory carries over between them.
 * Each arg is "Author>text" (or just "text"), posted as-is: include "mustardbot" or it's ignored like real chat.
 */
async function runConvo(rest) {
  if (!rest.length) usage('convo needs messages, e.g. convo "Alice>mustardbot what counters PA?" "Bob>mustardbot only supports"');
  const turns = [];
  for (const arg of rest) {
    const sep = arg.indexOf(">");
    const [author, text] = sep > 0 ? [arg.slice(0, sep).trim(), arg.slice(sep + 1).trim()] : ["driver", arg];
    turns.push({ author, text, ...(await postMessage(text, { mention: false, author })) });
  }
  const { memory } = await import("../../../src/assistant/index.js");
  return { mode: "convo", turns, memory: memory.get("driver-guild:driver-channel") };
}

async function runList() {
  const { commands } = await import("../../../src/discord/commands/index.js");
  return { mode: "list", commands: [...commands.values()].map((c) => c.data.toJSON()) };
}

async function runLive() {
  const { loadDiscordEnv } = await import("../../../src/config/env.js");
  let discordEnv;
  try {
    discordEnv = loadDiscordEnv();
  } catch (err) {
    return { mode: "live", skipped: true, reason: err.message };
  }
  const { createClient } = await import("../../../src/discord/client.js");
  const client = createClient(discordEnv.BOT_TRIGGER_NAMES);
  const ready = new Promise((resolve) => client.once("clientReady", resolve));
  let timer;
  try {
    // login() rejects fast (~0.5s, code TokenInvalid) on a bad token; the timer only guards a hung gateway.
    await client.login(discordEnv.DISCORD_TOKEN);
    const c = await Promise.race([
      ready,
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("timed out waiting for ready (30s)")), 30_000))),
    ]);
    return { mode: "live", ok: true, user: c.user.tag, id: c.user.id, guilds: c.guilds.cache.map((g) => g.name), wsPingMs: c.ws.ping };
  } catch (err) {
    return { mode: "live", ok: false, code: err.code ?? null, error: err.message };
  } finally {
    clearTimeout(timer);
    await client.destroy();
  }
}

/** Human-readable rendering of captured responses (for --text). */
function toText(result) {
  if (result.mode === "list" || result.mode === "live") return JSON.stringify(result, null, 2);
  if (result.mode === "convo") {
    const out = result.turns.map((t) => `## ${t.author}: ${t.text} (${t.ms}ms)\n${responsesText(t.responses) || "(ignored - not addressed to the bot)"}`);
    const mem = result.memory.map((m, i) => `${i + 1}. ${m.author}: "${m.question}" -> ${m.answer}`);
    return [...out, `## channel memory (${result.memory.length} turns)`, ...mem].join("\n\n");
  }
  const header = `# ${result.mode} ${[result.command, result.subcommand, result.customId, result.text].filter(Boolean).join(" ")} (${result.ms ?? 0}ms)`;
  return [header, responsesText(result.responses ?? [])].filter(Boolean).join("\n");
}

function responsesText(responses) {
  const lines = [];
  for (const r of responses) {
    if (r.kind === "deferReply" || r.kind === "typing") {
      lines.push(`[${r.kind}${r.ephemeral ? ", ephemeral" : ""}]`);
      continue;
    }
    if (r.kind === "autocomplete") {
      lines.push(`[autocomplete] ${r.choices.map((c) => `${c.name}=${c.value}`).join(", ")}`);
      continue;
    }
    lines.push(`[${r.kind}${r.ephemeral ? ", ephemeral" : ""}]`);
    if (r.content) lines.push(r.content);
    for (const e of r.embeds ?? []) {
      if (e.title) lines.push(`== ${e.title} ==`);
      if (e.description) lines.push(e.description);
      for (const f of e.fields ?? []) lines.push(`-- ${f.name}\n${f.value}`);
      if (e.footer?.text) lines.push(`(footer) ${e.footer.text}`);
    }
    for (const row of r.components ?? []) {
      for (const c of row.components ?? []) {
        const opts = c.options ? ` options: ${c.options.map((o) => `${o.label}=${o.value}`).join(", ")}` : "";
        lines.push(`[component ${c.type === 2 ? "button" : "select"}] ${c.label ?? c.placeholder ?? ""} customId=${c.custom_id}${opts}`);
      }
    }
  }
  return lines.join("\n");
}

const runners = {
  cmd: runCmd,
  autocomplete: runAutocomplete,
  component: runComponent,
  message: runMessage,
  say: (rest) => runMessage(rest, { mention: false }),
  convo: runConvo,
  list: runList,
  live: runLive,
};
const runner = runners[mode];
if (!runner) usage(mode ? `unknown mode "${mode}"` : undefined);

// Never call process.exit() after a fetch on Windows: undici's sockets are still closing and libuv aborts with
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)". Set exitCode and let the event loop drain instead.
try {
  const result = await runner(args);
  console.log(textMode ? toText(result) : JSON.stringify(result, null, 2));
  const answered = (responses) => responses?.some((r) => r.kind !== "deferReply" && r.kind !== "typing");
  const replied =
    result.skipped || result.mode === "list" || result.ok === true || answered(result.responses) || result.turns?.some((t) => answered(t.responses));
  process.exitCode = replied ? 0 : 1;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}

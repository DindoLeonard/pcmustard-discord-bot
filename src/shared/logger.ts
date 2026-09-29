type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /token|key|secret|password|authorization/i;

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : v instanceof Error ? { message: v.message, name: v.name } : v;
  }
  return out;
}

function currentLevel(): Level {
  const l = process.env.LOG_LEVEL as Level | undefined;
  return l && l in order ? l : "info";
}

function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (order[level] < order[currentLevel()]) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...redact(fields) });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log("error", msg, fields),
};

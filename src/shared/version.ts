import { readFileSync } from "node:fs";

/**
 * The bot's version, read from package.json (the single source of truth; bump it with `npm version`).
 * Resolved relative to this file, which sits two levels below the repo root in both src/ and dist/.
 */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const VERSION = readVersion();

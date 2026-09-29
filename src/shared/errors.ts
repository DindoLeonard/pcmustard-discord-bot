export class HeroNotFoundError extends Error {
  constructor(
    public readonly query: string,
    public readonly suggestions: string[],
    /** How many of the leading suggestions came from the AI (0 = all from fuzzy matching). */
    public readonly aiSuggestionCount = 0,
  ) {
    super(`Hero not found: ${query}`);
    this.name = "HeroNotFoundError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    cause?: unknown,
  ) {
    super(`Data provider unavailable: ${provider}`, { cause });
    this.name = "ProviderUnavailableError";
  }
}

/** A user-facing validation problem; the message is shown to the user as-is. */
export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

export class InvalidDraftError extends UserInputError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDraftError";
  }
}

export class SameHeroError extends UserInputError {
  constructor(hero: string) {
    super(`Pick two different heroes (both were ${hero}).`);
    this.name = "SameHeroError";
  }
}

/** Unknown account, or an account with no public match data (private profile). User-facing message. */
export class PlayerNotFoundError extends UserInputError {
  constructor(
    public readonly accountRef: string,
    reason: "unknown" | "no_data" = "unknown",
  ) {
    super(
      reason === "unknown"
        ? `I couldn't find a Dota account for "${accountRef}". Use the Friend ID from their Dota profile (or an OpenDota/Dotabuff link).`
        : `Account ${accountRef} has no public match data. They need to turn on "Expose Public Match Data" in Dota 2 settings (Options → Social).`,
    );
    this.name = "PlayerNotFoundError";
  }
}

export class AIUnavailableError extends Error {
  constructor(reason: string, cause?: unknown) {
    super(`AI unavailable: ${reason}`, { cause });
    this.name = "AIUnavailableError";
  }
}

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`Not implemented yet: ${feature}`);
    this.name = "NotImplementedError";
  }
}

export class UnknownGameError extends Error {
  constructor(public readonly game: string) {
    super(`Unsupported game: ${game}`);
    this.name = "UnknownGameError";
  }
}

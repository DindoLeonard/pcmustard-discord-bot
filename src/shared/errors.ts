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

// Desktop shell state only: what this browser's TV was last left on. It
// never reaches the server and never decides what airs.
const STORAGE_KEY = "krazitv.tv";

/** The TV's settings as this browser last left them. */
interface TvMemory {
  channelId?: string;
  /** From 0 to 1, as a video element's volume is. */
  volume: number;
  muted: boolean;
}

const DEFAULTS: TvMemory = { volume: 1, muted: false };

/** Reads what this browser remembers; missing, unreadable, or blocked storage counts as the defaults. */
export function readTvMemory(): TvMemory {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as unknown;
    if (typeof value !== "object" || value === null) return DEFAULTS;
    const record = value as Record<string, unknown>;
    return {
      ...(typeof record.channelId === "string"
        ? { channelId: record.channelId }
        : {}),
      volume:
        typeof record.volume === "number" &&
        record.volume >= 0 &&
        record.volume <= 1
          ? record.volume
          : DEFAULTS.volume,
      muted: typeof record.muted === "boolean" ? record.muted : DEFAULTS.muted,
    };
  } catch {
    /* Unreadable memory just means the TV starts at its defaults. */
    return DEFAULTS;
  }
}

/** Stores the TV's settings; blocked storage only means the next visit starts from the defaults. */
export function rememberTv(memory: TvMemory): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    /* Private windows may refuse storage; starting over is harmless. */
  }
}

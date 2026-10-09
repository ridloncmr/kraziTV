/**
 * Evidence read from a media item's filename and parent folders. Path hints
 * build provider queries and fallback titles; they are never accepted content
 * metadata. Absent fields are unknown.
 */
export interface PathHints {
  /** An episodic file's series name. */
  series?: string;
  /**
   * An episode's series folder below the media root, `/`-joined: its nearest
   * naming folder, or its own folder when no folder names anything (`""` at
   * the root). Episodes sharing it and their series name share one series.
   */
  seriesFolder?: string;
  /** A non-episodic file's movie title. */
  title?: string;
  /** A year written in the name, such as `(2002)`; never a release date. */
  year?: number;
  season?: number;
  /** The file's episode, or both ends of a multi-episode range. */
  episode?: { first: number; last: number };
  disc?: number;
  /** A rip's track number; never an episode number. */
  track?: number;
  /** True under an extras folder: never automatically matched. */
  extra: boolean;
  /** Weak hints never yield an automatic match. */
  strength: "strong" | "weak";
}

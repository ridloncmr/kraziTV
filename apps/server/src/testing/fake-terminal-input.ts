// Test-only terminal stdin; production code must never import this module.
import { PassThrough } from "node:stream";

/**
 * A stdin stand-in that a test types into with `write` and ends with `end`.
 * It records raw mode the way a TTY `ReadStream` would, so tests can prove a
 * prompt always restores the terminal.
 */
export class FakeTerminalInput extends PassThrough {
  rawMode = false;

  /** Records the mode instead of switching a real terminal. */
  setRawMode(mode: boolean): this {
    this.rawMode = mode;
    return this;
  }
}

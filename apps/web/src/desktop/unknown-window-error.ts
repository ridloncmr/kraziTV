/**
 * Thrown when a window ID names no program. Every window is opened from the
 * program catalog, so this is a programming error; it names the ID instead
 * of letting an undefined definition fail later in a title bar or taskbar.
 */
export class UnknownWindowError extends Error {
  // Carries the window ID in the message, which is all a developer needs.
  constructor(id: string) {
    super(`No program defines window "${id}"`);
    this.name = "UnknownWindowError";
  }
}

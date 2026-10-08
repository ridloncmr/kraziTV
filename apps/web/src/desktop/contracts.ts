/** Stable singleton program identities; the shell stores presentation only. */
export type ProgramId =
  | "channels"
  | "media"
  | "collections"
  | "guide"
  | "plex"
  | "monitor"
  | "account";

export interface DesktopWindow {
  id: ProgramId;
  /** Creation order keeps taskbar positions stable when stacking order changes. */
  openedOrder: number;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
}

export type WindowAction =
  | {
      type: "open" | "close" | "focus" | "minimize" | "maximize";
      id: ProgramId;
    }
  | { type: "move"; id: ProgramId; x: number; y: number }
  | { type: "resize"; id: ProgramId; width: number; height: number };

/** The usable desktop area: the browser viewport minus the taskbar. */
export interface DesktopViewport {
  width: number;
  height: number;
}

export interface ProgramDefinition {
  id: ProgramId;
  name: string;
  description: string;
  group: "Primary" | "Server";
}

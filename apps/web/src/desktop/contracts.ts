/** Stable singleton program identities; the shell stores presentation only. */
export type ProgramId =
  | "channels"
  | "media"
  | "collections"
  | "guide"
  | "plex"
  | "monitor"
  | "account";

/** The properties windows, each showing one channel or one collection. */
export type PropertiesKind = "channel-properties" | "collection-properties";

/**
 * A window's identity: a singleton program, or one object's properties
 * window, such as `channel-properties:<channel id>`, so each channel and
 * collection opens in a window of its own.
 */
export type WindowId = ProgramId | `${PropertiesKind}:${string}`;

export interface DesktopWindow {
  id: WindowId;
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
      id: WindowId;
    }
  | { type: "move"; id: WindowId; x: number; y: number }
  | { type: "resize"; id: WindowId; width: number; height: number };

/** The usable desktop area: the browser viewport minus the taskbar. */
export interface DesktopViewport {
  width: number;
  height: number;
}

export interface ProgramDefinition {
  /** A program, or a properties kind standing for every window of that kind. */
  id: ProgramId | PropertiesKind;
  name: string;
  description: string;
  group: "Primary" | "Server";
  /** Where the window first opens, before this browser remembers one; otherwise it cascades. */
  placement?: Pick<DesktopWindow, "x" | "y" | "width" | "height">;
}

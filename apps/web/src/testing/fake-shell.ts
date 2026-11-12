import { vi } from "vitest";
import type {
  DesktopWindow,
  ProgramId,
  ProgramTask,
  WindowId,
} from "../desktop/contracts.js";
import type { PropertiesWindows } from "../desktop/windows/use-properties-windows.js";
import { windowReducer } from "../desktop/windows/window-state.js";
import { account } from "./auth-fixtures.js";

/**
 * Stands for the desktop shell behind the program host. Its `openProgram`
 * applies the shell's own open action to the real window reducer, so a test
 * reads which windows a program opened and which one is in front without
 * rendering the whole desktop; `watchChannel` opens TV the same way, and the
 * channel it tunes is the call's argument. `open` lists the windows already
 * open, back to front. Every other host prop is an inert stand-in.
 */
export function fakeShell(...open: WindowId[]) {
  let windows = open.reduce<DesktopWindow[]>(
    (state, id) => windowReducer(state, { type: "open", id }),
    [],
  );
  const openProgram = vi.fn<(id: ProgramId, task?: ProgramTask) => void>(
    (id) => {
      windows = windowReducer(windows, { type: "open", id });
    },
  );
  const watchChannel = vi.fn<(channelId: string) => void>(() => {
    windows = windowReducer(windows, { type: "open", id: "tv" });
  });
  const properties: PropertiesWindows = {
    revision: 0,
    show: vi.fn(),
    read: vi.fn(),
    changed: vi.fn(),
    deleted: vi.fn(),
  };
  return {
    /** The open windows, back to front, so the last one is focused. */
    windowIds: () => windows.map((window) => window.id),
    hostProps: {
      connection: "kraziTV is running",
      account,
      onAccountChanged: vi.fn(),
      tmdbTaskRequest: 0,
      discoverRequest: 0,
      onTmdbKeyChanged: vi.fn(),
      onScanJobStarted: vi.fn(),
      onRecommendationDecided: vi.fn(),
      openProgram,
      watchRequest: undefined,
      watchChannel,
      channelWindows: properties,
      collectionWindows: properties,
      markUnsaved: vi.fn(),
    },
  };
}

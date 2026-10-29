import type {
  ProgramDefinition,
  ProgramId,
  PropertiesKind,
  WindowId,
} from "./contracts.js";
import { UnknownWindowError } from "./unknown-window-error.js";

/** One navigation catalog supplies desktop, Start, title bars and taskbar labels. */
export const programs: readonly (ProgramDefinition & { id: ProgramId })[] = [
  {
    id: "channels",
    name: "My Channels",
    description: "Configure your broadcast channels",
    group: "Primary",
    // Narrow enough that Channel Properties opens beside it.
    placement: { x: 140, y: 40, width: 460, height: 540 },
  },
  {
    id: "media",
    name: "Media Library",
    description: "Discover and scan local media",
    group: "Primary",
  },
  {
    id: "collections",
    name: "Collections",
    description: "Arrange media for programming",
    group: "Primary",
    // Narrow enough that Collection Properties opens beside it.
    placement: { x: 140, y: 40, width: 460, height: 540 },
  },
  {
    id: "guide",
    name: "Program Guide",
    description: "Browse generated programming",
    group: "Primary",
  },
  {
    id: "tv",
    name: "TV",
    description: "Watch your channels",
    group: "Primary",
    // A 16:9 picture over the now and next strip and the controls.
    placement: { x: 180, y: 60, width: 660, height: 500 },
  },
  {
    id: "plex",
    name: "Plex Setup",
    description: "Connect your Plex Live TV tuner",
    group: "Server",
  },
  {
    id: "monitor",
    name: "Live Monitor",
    description: "Inspect current channel state",
    group: "Server",
  },
  {
    id: "account",
    name: "Account Settings",
    description: "Change your name, picture, or password",
    group: "Server",
  },
];

/**
 * One channel's or collection's own window. My Channels and Collections open
 * them, so they have no desktop shortcut or Start entry; the first of each
 * opens beside its program on a 1280px screen.
 */
const propertiesPrograms: Record<PropertiesKind, ProgramDefinition> = {
  "channel-properties": {
    id: "channel-properties",
    name: "Channel Properties",
    description: "Set up one channel's identity and programming",
    group: "Primary",
    placement: { x: 620, y: 40, width: 640, height: 600 },
  },
  "collection-properties": {
    id: "collection-properties",
    name: "Collection Properties",
    description: "Edit one collection's members and order",
    group: "Primary",
    placement: { x: 620, y: 40, width: 640, height: 600 },
  },
};

/** The window that shows one channel's or collection's properties. */
export function propertiesWindow(
  kind: PropertiesKind,
  objectId: string,
): WindowId {
  return `${kind}:${objectId}`;
}

/** What a properties window shows, or undefined for any other window. */
export function propertiesTarget(
  id: WindowId,
): { kind: PropertiesKind; objectId: string } | undefined {
  const separator = id.indexOf(":");
  if (separator === -1) return undefined;
  return {
    kind: id.slice(0, separator) as PropertiesKind,
    objectId: id.slice(separator + 1),
  };
}

/**
 * Finds any window's definition, including those no launcher lists. Throws
 * `UnknownWindowError` for an ID no program defines, since every window is
 * opened from this catalog.
 */
export function programOf(id: WindowId): ProgramDefinition {
  const target = propertiesTarget(id);
  const program = target
    ? (propertiesPrograms[target.kind] as ProgramDefinition | undefined)
    : programs.find((candidate) => candidate.id === id);
  if (program === undefined) throw new UnknownWindowError(id);
  return program;
}

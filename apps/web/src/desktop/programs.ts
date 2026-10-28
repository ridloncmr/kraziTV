import type { ProgramDefinition, ProgramId } from "./contracts.js";

/** One navigation catalog supplies desktop, Start, title bars and taskbar labels. */
export const programs: readonly ProgramDefinition[] = [
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
  },
  {
    id: "guide",
    name: "Program Guide",
    description: "Browse generated programming",
    group: "Primary",
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
 * One channel's property sheet. My Channels opens it, so it has no desktop
 * shortcut or Start entry; it opens beside My Channels on a 1280px screen.
 */
const channelProperties: ProgramDefinition = {
  id: "channel-properties",
  name: "Channel Properties",
  description: "Set up one channel's identity and programming",
  group: "Primary",
  placement: { x: 620, y: 40, width: 640, height: 600 },
};

/** Finds any window's definition, including those no launcher lists. */
export function programById(id: ProgramId): ProgramDefinition {
  return id === channelProperties.id
    ? channelProperties
    : programs.find((program) => program.id === id)!;
}

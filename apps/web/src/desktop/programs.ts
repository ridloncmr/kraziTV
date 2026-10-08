import type { ProgramDefinition } from "./contracts.js";

/** One navigation catalog supplies desktop, Start, title bars and taskbar labels. */
export const programs: readonly ProgramDefinition[] = [
  {
    id: "channels",
    name: "My Channels",
    description: "Configure your broadcast channels",
    group: "Primary",
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

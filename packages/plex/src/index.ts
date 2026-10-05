/**
 * Plex adapter formatting: HDHomeRun tuner responses and XMLTV guide data
 * built from plain values. Routes, persistence, and streaming live elsewhere.
 */

export {
  formatDeviceXml,
  formatDiscovery,
  formatLineupStatus,
} from "./hdhomerun/device.js";
export { formatLineup } from "./hdhomerun/lineup.js";

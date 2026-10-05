// Fixed tuner metadata. Plex shows FriendlyName in setup; the rest only needs
// to be stable, because Plex keys a tuner by DeviceID.
const FRIENDLY_NAME = "kraziTV";
const MANUFACTURER = "kraziTV";
const MODEL_NUMBER = "KRAZITV-TUNER";
const FIRMWARE_NAME = "krazitv";
const FIRMWARE_VERSION = "1.0";
// Plex echoes DeviceAuth back but never validates it for a manual tuner.
const DEVICE_AUTH = "krazitv";

/** The deployment's tuner identity, with absolute URLs the server already built. */
interface DeviceIdentity {
  deviceId: string;
  tunerCount: number;
  baseUrl: string;
  lineupUrl: string;
}

/**
 * Builds `discover.json` with exactly the fields Plex was verified to accept
 * on 2026-09-29, so manual tuner setup sees a stable HDHomeRun device.
 */
export function formatDiscovery(identity: DeviceIdentity) {
  return {
    FriendlyName: FRIENDLY_NAME,
    Manufacturer: MANUFACTURER,
    ModelNumber: MODEL_NUMBER,
    FirmwareName: FIRMWARE_NAME,
    FirmwareVersion: FIRMWARE_VERSION,
    DeviceID: identity.deviceId,
    DeviceAuth: DEVICE_AUTH,
    BaseURL: identity.baseUrl,
    LineupURL: identity.lineupUrl,
    TunerCount: identity.tunerCount,
  };
}

/**
 * Builds `lineup_status.json`. kraziTV's lineup is always ready, so it reports
 * an idle scan and Plex reads the lineup without waiting.
 */
export function formatLineupStatus() {
  return {
    ScanInProgress: 0,
    ScanPossible: 1,
    Source: "Antenna",
    SourceList: ["Antenna"],
  };
}

/**
 * Builds the UPnP `device.xml`. Every value is a constant or the validated hex
 * device ID, so nothing needs XML escaping.
 */
export function formatDeviceXml(deviceId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>${FRIENDLY_NAME}</friendlyName>
    <manufacturer>${MANUFACTURER}</manufacturer>
    <modelName>${FRIENDLY_NAME}</modelName>
    <modelNumber>${MODEL_NUMBER}</modelNumber>
    <serialNumber>${deviceId}</serialNumber>
    <UDN>uuid:${deviceId}</UDN>
  </device>
</root>
`;
}

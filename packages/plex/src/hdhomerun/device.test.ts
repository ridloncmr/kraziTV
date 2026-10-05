import { describe, expect, it } from "vitest";

import {
  formatDeviceXml,
  formatDiscovery,
  formatLineupStatus,
} from "./device.js";

const DEVICE = {
  deviceId: "0BADF00D",
  tunerCount: 3,
  baseUrl: "http://tv.lan:8080",
  lineupUrl: "http://tv.lan:8080/lineup.json",
};

describe("formatDiscovery", () => {
  it("returns exactly the discovery fields Plex verified, carrying the device identity", () => {
    const discovery = formatDiscovery(DEVICE);

    expect(Object.keys(discovery).sort()).toEqual(
      [
        "FriendlyName",
        "Manufacturer",
        "ModelNumber",
        "FirmwareName",
        "FirmwareVersion",
        "DeviceID",
        "DeviceAuth",
        "BaseURL",
        "LineupURL",
        "TunerCount",
      ].sort(),
    );
    expect(discovery).toMatchObject({
      DeviceID: "0BADF00D",
      TunerCount: 3,
      BaseURL: "http://tv.lan:8080",
      LineupURL: "http://tv.lan:8080/lineup.json",
    });
  });
});

describe("formatLineupStatus", () => {
  it("reports an idle antenna scan so Plex reads the lineup directly", () => {
    expect(formatLineupStatus()).toStrictEqual({
      ScanInProgress: 0,
      ScanPossible: 1,
      Source: "Antenna",
      SourceList: ["Antenna"],
    });
  });
});

describe("formatDeviceXml", () => {
  it("carries the device ID in the serial number and UDN", () => {
    const xml = formatDeviceXml(DEVICE.deviceId);

    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain("<serialNumber>0BADF00D</serialNumber>");
    expect(xml).toContain("<UDN>uuid:0BADF00D</UDN>");
  });
});

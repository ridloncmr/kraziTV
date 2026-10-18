import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { transportPacket } from "../../testing/transport-packet.js";
import { MpegTsContinuity } from "./mpeg-ts-continuity.js";
import { MpegTsPacketForwarder } from "./mpeg-ts-packet-forwarder.js";

/** Collects everything written to the destination as one buffer. */
function collect(destination: PassThrough): () => Buffer {
  const chunks: Buffer[] = [];
  destination.on("data", (chunk: Buffer) => chunks.push(chunk));
  return () => Buffer.concat(chunks);
}

/** The continuity counter of each packet written, in order. */
function counters(written: Buffer): number[] {
  const found = [];
  for (let offset = 0; offset < written.byteLength; offset += 188) {
    found.push((written[offset + 3] ?? 0) & 0x0f);
  }
  return found;
}

describe("MpegTsContinuity", () => {
  // Each FFmpeg process counts from zero, so a splice would jump back.
  const counted = (cc: number, pesStart = false) => {
    const packet = transportPacket({ pid: 0x100, fill: 1, pesStart });
    packet[3] = 0x10 | cc;
    return packet;
  };

  it("keeps each stream's continuity counter continuous across the processes of one signal", () => {
    const destination = new PassThrough();
    const written = collect(destination);
    const continuity = new MpegTsContinuity(destination);
    const first = new PassThrough();
    const second = new PassThrough();

    const forwarder = new MpegTsPacketForwarder(first, continuity);
    first.write(
      Buffer.concat([counted(7, true), counted(8), counted(9, true)]),
    );
    forwarder.detach();
    new MpegTsPacketForwarder(second, continuity);
    second.write(
      Buffer.concat([counted(0, true), counted(1), counted(2, true)]),
    );

    expect(counters(written())).toEqual([7, 8, 9, 10]);
  });

  it("repeats the counter on a packet without payload and leaves null packets alone", () => {
    const destination = new PassThrough();
    const written = collect(destination);
    const continuity = new MpegTsContinuity(destination);
    const adaptationOnly = transportPacket({ pid: 0x100, fill: 1 });
    adaptationOnly[3] = 0x20 | 0x0c;
    const nullPacket = transportPacket({ pid: 0x1fff, fill: 0 });
    nullPacket[3] = 0x10 | 0x05;

    continuity.write(
      Buffer.concat([counted(3, true), adaptationOnly, nullPacket, counted(9)]),
    );

    expect(counters(written())).toEqual([3, 3, 5, 4]);
  });
});

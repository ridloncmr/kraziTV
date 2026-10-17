import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { transportPacket } from "../../testing/transport-packet.js";
import { MpegTsPacketForwarder } from "./mpeg-ts-packet-forwarder.js";

/** Collects everything written to the destination as one buffer. */
function collect(destination: PassThrough): () => Buffer {
  const chunks: Buffer[] = [];
  destination.on("data", (chunk: Buffer) => chunks.push(chunk));
  return () => Buffer.concat(chunks);
}

describe("MpegTsPacketForwarder", () => {
  it("forwards only whole packets and carries the partial tail", () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    const written = collect(destination);
    new MpegTsPacketForwarder(source, destination);

    source.write(Buffer.alloc(300, 1));
    expect(written().byteLength).toBe(188);

    source.write(Buffer.alloc(76, 2));
    expect(written().byteLength).toBe(376);
    expect(written().subarray(188, 300)).toEqual(Buffer.alloc(112, 1));
    expect(written().subarray(300)).toEqual(Buffer.alloc(76, 2));
  });

  it("drops the partial tail and stops forwarding once detached", () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    const written = collect(destination);
    const forwarder = new MpegTsPacketForwarder(source, destination);

    source.write(Buffer.alloc(100));
    forwarder.detach();
    source.write(Buffer.alloc(188));

    expect(written().byteLength).toBe(0);
  });
  it("holds a stream's open PES until its next one starts, keeping packet order", () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    const written = collect(destination);
    new MpegTsPacketForwarder(source, destination);
    const video = (fill: number, pesStart = false) =>
      transportPacket({ pid: 0x100, fill, pesStart });
    const audio = (fill: number) =>
      transportPacket({ pid: 0x101, fill, pesStart: true });

    source.write(Buffer.concat([video(1, true), audio(2), video(3)]));
    expect(written()).toEqual(Buffer.alloc(0));

    source.write(Buffer.concat([audio(4), video(5, true)]));
    expect(written()).toEqual(
      Buffer.concat([video(1, true), audio(2), video(3)]),
    );
  });

  it("drops each stream's unfinished PES when detached mid-media, so a cut leaves no corrupt frame", () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    const written = collect(destination);
    const forwarder = new MpegTsPacketForwarder(source, destination);
    const video = (fill: number, pesStart = false) =>
      transportPacket({ pid: 0x100, fill, pesStart });
    const audio = (fill: number) =>
      transportPacket({ pid: 0x101, fill, pesStart: true });
    const pat = transportPacket({ pid: 0, fill: 9 });

    source.write(
      Buffer.concat([
        video(1, true),
        audio(2),
        video(3, true),
        pat,
        audio(4),
        video(5),
      ]),
    );
    forwarder.detach();

    // The first frame and first audio unit finished; the rest never did.
    expect(written()).toEqual(Buffer.concat([video(1, true), audio(2), pat]));
  });

  it("forwards everything once the FFmpeg process ends on its own", () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    const written = collect(destination);
    new MpegTsPacketForwarder(source, destination);
    const last = transportPacket({ pid: 0x100, fill: 1, pesStart: true });

    source.end(last);

    return new Promise<void>((resolve) =>
      source.once("end", () => {
        expect(written()).toEqual(last);
        resolve();
      }),
    ).then(() => undefined);
  });
});

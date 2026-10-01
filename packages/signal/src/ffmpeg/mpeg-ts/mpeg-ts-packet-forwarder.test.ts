import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

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
});

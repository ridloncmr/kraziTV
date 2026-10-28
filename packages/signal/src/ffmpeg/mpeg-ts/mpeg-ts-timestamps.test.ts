import { describe, expect, it } from "vitest";

import { transportPacket } from "../../testing/transport-packet.js";
import {
  MPEG_TS_PACKET_BYTES,
  packetPid,
  pcrBaseOffset,
  pesTimestampFields,
  readPcrBase,
  readTimestamp,
} from "./mpeg-ts-packet-run.js";
import { MpegTsTimestamps } from "./mpeg-ts-timestamps.js";

const VIDEO = 0x100;
const AUDIO = 0x101;
const FRAME = 3_000;
// Where FFmpeg starts every process's timestamps: 1.4 s at 90 kHz.
const START = 126_000;

/** Every written packet's PID and timestamps, in order. */
type Written = { pid: number; dts?: number; pts?: number; pcr?: number };

/** Collects what the timestamps sink writes, decoded. */
function collector(): {
  sink: { write(packets: Buffer): void };
  written: Written[];
} {
  const written: Written[] = [];
  return {
    written,
    sink: {
      write(packets: Buffer) {
        for (
          let offset = 0;
          offset < packets.byteLength;
          offset += MPEG_TS_PACKET_BYTES
        ) {
          const entry: Written = { pid: packetPid(packets, offset) };
          const fields = pesTimestampFields(packets, offset);
          if (fields !== undefined) {
            entry.pts = readTimestamp(packets, fields.ptsAt);
            entry.dts = readTimestamp(packets, fields.dtsAt ?? fields.ptsAt);
          }
          const pcrAt = pcrBaseOffset(packets, offset);
          if (pcrAt !== undefined) entry.pcr = readPcrBase(packets, pcrAt);
          written.push(entry);
        }
      },
    },
  };
}

/** One video frame as a B-frame encode writes it, with PTS one frame after DTS. */
const video = (dts: number, pcr?: number) =>
  transportPacket({
    pid: VIDEO,
    pts: dts + FRAME,
    dts,
    ...(pcr === undefined ? {} : { pcr }),
  });
const audio = (pts: number) => transportPacket({ pid: AUDIO, pts });

describe("MpegTsTimestamps", () => {
  it("passes the first process's timestamps through unchanged", () => {
    const { sink, written } = collector();
    const timestamps = new MpegTsTimestamps(sink);
    timestamps.splice();
    timestamps.write(Buffer.concat([video(START, START), audio(START)]));

    expect(written).toEqual([
      { pid: VIDEO, dts: START, pts: START + FRAME, pcr: START },
      { pid: AUDIO, dts: START, pts: START },
    ]);
  });

  it("continues every stream after its own last frame when the next process restarts its timestamps", () => {
    const { sink, written } = collector();
    const timestamps = new MpegTsTimestamps(sink);
    timestamps.write(
      Buffer.concat([
        video(START),
        video(START + FRAME),
        audio(START),
        audio(START + 1_920),
      ]),
    );

    timestamps.splice();
    timestamps.write(Buffer.concat([video(START, START), audio(START)]));

    const spliced = written.slice(4);
    // Video ends at DTS START+FRAME, PTS START+2*FRAME; its next frame needs
    // PTS after that, so both streams shift by 2*FRAME.
    expect(spliced).toEqual([
      {
        pid: VIDEO,
        dts: START + 2 * FRAME,
        pts: START + 3 * FRAME,
        pcr: START + 2 * FRAME,
      },
      { pid: AUDIO, dts: START + 2 * FRAME, pts: START + 2 * FRAME },
    ]);
  });

  it("holds a splice's packets until every stream that aired has shown a timestamp", () => {
    const { sink, written } = collector();
    const timestamps = new MpegTsTimestamps(sink);
    timestamps.write(Buffer.concat([video(START), audio(START)]));

    timestamps.splice();
    timestamps.write(video(START));
    expect(written).toHaveLength(2);

    // Audio starts later in this process than video, so video, which must
    // follow its own last frame, sets the shift and audio keeps its lead.
    timestamps.write(audio(START + 10_000));
    expect(written).toHaveLength(4);
    expect(written[2]?.dts).toBe(START + FRAME);
    expect(written[3]?.pts).toBe(START + 10_000 + FRAME);
  });

  it("fixes the shift without a stream that has not appeared within half a second", () => {
    const { sink, written } = collector();
    const timestamps = new MpegTsTimestamps(sink);
    timestamps.write(Buffer.concat([video(START), audio(START)]));

    timestamps.splice();
    timestamps.write(video(START));
    timestamps.write(video(START + 45_000));
    expect(written).toHaveLength(2);
    timestamps.write(video(START + 45_001));

    expect(written.slice(2).map((entry) => entry.dts)).toEqual([
      START + FRAME,
      START + FRAME + 45_000,
      START + FRAME + 45_001,
    ]);
  });

  it("writes held program tables when the next splice comes first", () => {
    const { sink, written } = collector();
    const timestamps = new MpegTsTimestamps(sink);
    timestamps.write(video(START));

    timestamps.splice();
    timestamps.write(transportPacket({ pid: 0 }));
    timestamps.splice();
    timestamps.write(video(START));

    expect(written).toEqual([
      { pid: VIDEO, dts: START, pts: START + FRAME },
      { pid: 0 },
      { pid: VIDEO, dts: START + FRAME, pts: START + 2 * FRAME },
    ]);
  });

  it("moves a process returning from a stall after what aired while it was away", () => {
    const { sink, written } = collector();
    const timestamps = new MpegTsTimestamps(sink);
    timestamps.write(video(START + 100 * FRAME));

    // A stand-in airs ten frames from its own start.
    timestamps.splice();
    for (let frame = 0; frame < 10; frame += 1)
      timestamps.write(video(START + frame * FRAME));

    // The stalled process resumes where it froze, which is now in the past.
    timestamps.splice();
    timestamps.write(video(START + 101 * FRAME));

    expect(written.at(-1)?.dts).toBe(START + 111 * FRAME);
  });

  it("places a resumed item's B-frames after what aired, though they display before its first frame", () => {
    const { sink, written } = collector();
    const timestamps = new MpegTsTimestamps(sink);
    const last = START + 100 * FRAME;
    timestamps.write(
      transportPacket({ pid: VIDEO, dts: last, pts: last + 2 * FRAME }),
    );

    // A P-frame, then the B-frame displayed before it.
    timestamps.splice();
    timestamps.write(
      Buffer.concat([
        transportPacket({ pid: VIDEO, dts: START, pts: START + 2 * FRAME }),
        transportPacket({ pid: VIDEO, dts: START + FRAME, pts: START + FRAME }),
      ]),
    );

    expect(written.at(-1)?.pts).toBe(last + 3 * FRAME);
  });

  it("picks the latest shift when the candidates straddle half the timestamp range", () => {
    const { sink, written } = collector();
    const timestamps = new MpegTsTimestamps(sink);
    // The DTS candidate lands just under 2^32 and the PTS one just over.
    const last = START + 2 ** 32 - 1.5 * FRAME;
    timestamps.write(video(last));

    timestamps.splice();
    timestamps.write(transportPacket({ pid: VIDEO, pts: START }));

    expect(written.at(-1)?.pts).toBe(last + 2 * FRAME);
  });

  it("keeps the timeline running forward across the 33-bit wrap", () => {
    const { sink, written } = collector();
    const timestamps = new MpegTsTimestamps(sink);
    const nearWrap = 2 ** 33 - FRAME;
    timestamps.write(video(nearWrap));

    timestamps.splice();
    timestamps.write(video(START));

    expect(written.at(-1)?.dts).toBe(0);
    expect(written.at(-1)?.pts).toBe(FRAME);
  });
});

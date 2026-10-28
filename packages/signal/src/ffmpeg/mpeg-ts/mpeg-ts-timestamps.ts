import type { PacketSink } from "../contracts.js";
import {
  MPEG_TS_PACKET_BYTES,
  packetPid,
  pcrBaseOffset,
  pesTimestampFields,
  readPcrBase,
  readTimestamp,
  writePcrBase,
  writeTimestamp,
} from "./mpeg-ts-packet-run.js";

/** MPEG-TS timestamps are 33-bit counts of a 90 kHz clock that wrap. */
const TIMESTAMP_MODULUS = 2 ** 33;

/** One frame at the packager's 30 fps, for a stream that has shown only one. */
const DEFAULT_FRAME_TICKS = 3_000;

/**
 * How far a splice's first stream may run ahead before the shift is fixed
 * without the others: half a second at 90 kHz. FFmpeg starts every stream
 * within a few frames of each other, so this bounds the hold, not the shift.
 */
const MAX_SPLICE_SKEW_TICKS = 45_000;

/** One stream's place on the output timeline, from the last frame written. */
type StreamClock = {
  lastDts: number;
  maxPts: number;
  frameTicks: number;
};

/** A new process's packets held after a splice until its streams' first timestamps are known. */
type PendingSplice = {
  packets: Buffer[];
  /** Per PES PID, the first frame's DTS and the lowest PTS held, as its process wrote them. */
  first: Map<number, { dts: number; pts: number }>;
};

/**
 * Writes transport packets with every FFmpeg process's timestamps moved onto
 * one timeline that only runs forward (ADR 0021). Each process stamps its
 * own output from about 1.4 s, so without this every splice jumps back,
 * which browser players cannot play past. After `splice()`, the new process's
 * packets are held until each stream's first timestamp is known, then all
 * its PTS, DTS, and PCR values are shifted by one offset: the least that
 * puts every stream after its own last frame, so audio and video keep their
 * sync and no frame lands on time already aired.
 */
export class MpegTsTimestamps implements PacketSink {
  /** Per PES PID, where its last written frame sits on the output timeline. */
  private readonly clocks = new Map<number, StreamClock>();
  /** What the current process's timestamps are shifted by, modulo 2^33. */
  private offset = 0;
  private pending: PendingSplice | undefined;

  /** Takes the sink that continues the stream after its timestamps. */
  constructor(private readonly destination: PacketSink) {}

  /**
   * Marks that the next packets come from a different FFmpeg process, or a
   * process returning after others aired. A splice still waiting settles
   * first with what it knows. Before anything aired there is nothing to
   * continue, so the first process keeps its own timestamps.
   */
  splice(): void {
    if (this.pending !== undefined) this.settle();
    if (this.clocks.size === 0) return;
    this.pending = { packets: [], first: new Map() };
  }

  /** Shifts and writes the packets, or holds them while a splice is pending. */
  write(packets: Buffer): void {
    if (packets.byteLength === 0) return;
    const pending = this.pending;
    if (pending === undefined) {
      this.shift(packets);
      this.destination.write(packets);
      return;
    }
    pending.packets.push(packets);
    if (this.observeFirstFrames(pending, packets)) this.settle();
  }

  /**
   * Records each stream's first DTS and lowest PTS in `packets`, and reports
   * whether the shift can now be fixed: every stream that aired before has
   * shown a timestamp, or a stream has run too far ahead to wait for the
   * rest. The lowest PTS, not the first, counts because a resumed item may
   * return on a frame displayed after the B-frames that follow it.
   */
  private observeFirstFrames(pending: PendingSplice, packets: Buffer): boolean {
    let ranAhead = false;
    for (
      let offset = 0;
      offset < packets.byteLength;
      offset += MPEG_TS_PACKET_BYTES
    ) {
      const fields = pesTimestampFields(packets, offset);
      if (fields === undefined) continue;
      const pts = readTimestamp(packets, fields.ptsAt);
      const dts =
        fields.dtsAt === undefined ? pts : readTimestamp(packets, fields.dtsAt);
      const pid = packetPid(packets, offset);
      const first = pending.first.get(pid);
      if (first === undefined) {
        pending.first.set(pid, { dts, pts });
        continue;
      }
      if (timestampDifference(pts, first.pts) < 0) first.pts = pts;
      if (timestampDifference(dts, first.dts) > MAX_SPLICE_SKEW_TICKS) {
        ranAhead = true;
      }
    }
    return (
      ranAhead || [...this.clocks.keys()].every((pid) => pending.first.has(pid))
    );
  }

  /**
   * Fixes the pending splice's offset and writes what it held. A stream new
   * to the output places nothing; with no stream known the offset stays,
   * since held program tables carry no timestamps. Candidates are compared
   * with each other modulo 2^33, never as plain numbers, so a shift near
   * half the timestamp range still picks the latest.
   */
  private settle(): void {
    const pending = this.pending;
    if (pending === undefined) return;
    this.pending = undefined;
    let needed: number | undefined;
    const consider = (candidate: number): void => {
      if (needed === undefined || timestampDifference(candidate, needed) > 0) {
        needed = wrap(candidate);
      }
    };
    for (const [pid, first] of pending.first) {
      const clock = this.clocks.get(pid);
      if (clock === undefined) continue;
      consider(clock.lastDts + clock.frameTicks - first.dts);
      consider(clock.maxPts + clock.frameTicks - first.pts);
    }
    if (needed !== undefined) this.offset = needed;
    const held = Buffer.concat(pending.packets);
    this.shift(held);
    this.destination.write(held);
  }

  /** Moves every PTS, DTS, and PCR in `packets` by the offset, in place, and advances each stream's clock. */
  private shift(packets: Buffer): void {
    for (
      let offset = 0;
      offset < packets.byteLength;
      offset += MPEG_TS_PACKET_BYTES
    ) {
      const pcrAt = pcrBaseOffset(packets, offset);
      if (pcrAt !== undefined) {
        writePcrBase(
          packets,
          pcrAt,
          wrap(readPcrBase(packets, pcrAt) + this.offset),
        );
      }
      const fields = pesTimestampFields(packets, offset);
      if (fields === undefined) continue;
      const pts = wrap(readTimestamp(packets, fields.ptsAt) + this.offset);
      writeTimestamp(packets, fields.ptsAt, pts);
      let dts = pts;
      if (fields.dtsAt !== undefined) {
        dts = wrap(readTimestamp(packets, fields.dtsAt) + this.offset);
        writeTimestamp(packets, fields.dtsAt, dts);
      }
      this.advance(packetPid(packets, offset), dts, pts);
    }
  }

  /**
   * Records a written PES packet, learning the stream's PES spacing from the
   * step since its last one: one frame for video, several for audio, so
   * the next process starts after the last packet's content.
   */
  private advance(pid: number, dts: number, pts: number): void {
    const clock = this.clocks.get(pid);
    if (clock === undefined) {
      this.clocks.set(pid, {
        lastDts: dts,
        maxPts: pts,
        frameTicks: DEFAULT_FRAME_TICKS,
      });
      return;
    }
    const step = timestampDifference(dts, clock.lastDts);
    if (step > 0 && step <= MAX_SPLICE_SKEW_TICKS) clock.frameTicks = step;
    clock.lastDts = dts;
    if (timestampDifference(pts, clock.maxPts) > 0) clock.maxPts = pts;
  }
}

/** Brings any sum or difference of timestamps back into 0..2^33. */
function wrap(value: number): number {
  return ((value % TIMESTAMP_MODULUS) + TIMESTAMP_MODULUS) % TIMESTAMP_MODULUS;
}

/** How far `later` is after `earlier`, negative when before, across a wrap. */
function timestampDifference(later: number, earlier: number): number {
  const difference = wrap(later - earlier);
  return difference >= TIMESTAMP_MODULUS / 2
    ? difference - TIMESTAMP_MODULUS
    : difference;
}

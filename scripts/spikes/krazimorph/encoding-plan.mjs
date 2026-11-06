// The prototype encoding plan: a pure, deterministic decision from source
// facts and the packager's request to one of three strategies, with the
// reasons spelled out. This is the function the spike exists to shape; it
// never touches argv or FFmpeg.
//
//   legacy  today's fixed 1080p30 H.264 profile, argv left as the packager built it
//   encode  H.264 at the source's size and frame rate, fitted under the ceiling
//   copy    the source's H.264 video stream copied into the transport stream

/** Output boxes per ceiling, 16:9 and even-sized. */
export const CEILINGS = {
  480: { width: 854, height: 480 },
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
};

/** The highest frame rate a copied or native encode may carry. */
const MAX_FRAME_RATE = 60;

const INTERLACED_FIELD_ORDERS = new Set(["tt", "bb", "tb", "bt"]);

/**
 * Decides how one program's video is packaged.
 *
 * `mode` is the channel's broadcast format mode under test: `off` keeps the
 * legacy argv, `native` always encodes but at native size and rate, and
 * `auto` adds stream copy for eligible sources. `ceiling` is the maximum
 * output height. `request` describes what the packager asked for: the media
 * offset, whether this process starts the session or pads a black tail
 * (both encode for timing reasons), and whether the source's own video is
 * mapped at all.
 */
export function planEncoding({ facts, request, mode, ceiling }) {
  const box = CEILINGS[ceiling];
  if (box === undefined) {
    return legacy([`ceiling ${ceiling} is not one of 480, 720, 1080`]);
  }
  if (mode === "off") return legacy(["mode off"]);
  if (!request.sourceVideoMapped) {
    return legacy(["video is generated, not read from the source"]);
  }
  if (facts === undefined || facts.unknown) {
    return legacy(["source facts unknown; the known-good profile applies"]);
  }

  const reasons = [];
  const deinterlace = INTERLACED_FIELD_ORDERS.has(facts.fieldOrder);
  const fits = facts.width <= box.width && facts.height <= box.height;
  const rate = facts.frameRate?.value ?? 0;

  if (mode === "auto") {
    const blockers = copyBlockers(facts, request, fits, rate, deinterlace);
    if (blockers.length === 0) {
      return {
        strategy: "copy",
        reasons: [
          `h264 ${facts.width}x${facts.height} ${facts.pixelFormat} at ${rateLabel(facts)} fits the ${ceiling}p ceiling`,
          "boundary start at offset 0 with no burst and no black tail",
        ],
        video: {
          width: facts.width,
          height: facts.height,
          scale: false,
          deinterlace: false,
          frameRate: facts.frameRate.text,
          gop: Math.max(1, Math.round(rate)),
        },
      };
    }
    reasons.push(...blockers.map((blocker) => `no copy: ${blocker}`));
  }

  const size = fits
    ? { width: facts.width, height: facts.height }
    : fit(facts, box);
  reasons.push(
    fits
      ? `native ${facts.width}x${facts.height} kept under the ${ceiling}p ceiling`
      : `${facts.width}x${facts.height} downscaled to ${size.width}x${size.height} for the ${ceiling}p ceiling`,
  );
  const frameRate = nativeFrameRate(facts, reasons);
  if (deinterlace)
    reasons.push(`deinterlaced: field order ${facts.fieldOrder}`);
  if (facts.pixelFormat !== "yuv420p") {
    reasons.push(`${facts.pixelFormat} converted to yuv420p`);
  }
  return {
    strategy: "encode",
    reasons,
    video: {
      ...size,
      scale: !fits,
      deinterlace,
      frameRate: frameRate.text,
      gop: Math.max(1, Math.round(frameRate.value)),
    },
  };
}

/** Everything that rules out copying this source as this request asked. */
function copyBlockers(facts, request, fits, rate, deinterlace) {
  const blockers = [];
  if (facts.codec !== "h264") blockers.push(`codec ${facts.codec}`);
  if (facts.pixelFormat !== "yuv420p") {
    blockers.push(`pixel format ${facts.pixelFormat}`);
  }
  if (!fits) blockers.push("exceeds the ceiling");
  if (deinterlace) blockers.push(`interlaced (${facts.fieldOrder})`);
  if (rate === 0 || rate > MAX_FRAME_RATE) blockers.push(`frame rate ${rate}`);
  if (request.offsetMs !== 0)
    blockers.push(`starts mid-item at ${request.offsetMs} ms`);
  if (request.startsSession) blockers.push("first process of a session");
  if (request.blackTail) blockers.push("black tail needs a filter graph");
  return blockers;
}

/** The source rate, capped at 60 and defaulting to 30 when unknown. */
function nativeFrameRate(facts, reasons) {
  const rate = facts.frameRate;
  if (rate === undefined) {
    reasons.push("frame rate unknown; 30 fps");
    return { text: "30", value: 30 };
  }
  if (rate.value > MAX_FRAME_RATE) {
    reasons.push(`${rateLabel(facts)} capped at ${MAX_FRAME_RATE} fps`);
    return { text: String(MAX_FRAME_RATE), value: MAX_FRAME_RATE };
  }
  return rate;
}

/** Fits the stored frame inside the box, keeping its stored aspect, even-sized. */
function fit(facts, box) {
  const factor = Math.min(box.width / facts.width, box.height / facts.height);
  return {
    width: even(facts.width * factor),
    height: even(facts.height * factor),
  };
}

function even(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function rateLabel(facts) {
  const value = facts.frameRate?.value;
  return value === undefined ? "unknown fps" : `${value.toFixed(3)} fps`;
}

function legacy(reasons) {
  return { strategy: "legacy", reasons };
}

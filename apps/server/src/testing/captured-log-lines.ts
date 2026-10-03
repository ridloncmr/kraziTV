// Captures pino output for tests only; production code must never import this module.
import { Writable } from "node:stream";

/** One pino line, parsed: numeric level, message, and structured fields. */
export type CapturedLogLine = {
  level: number;
  msg: string;
  [field: string]: unknown;
};

/**
 * Returns a destination for a pino or Fastify logger and the lines written to
 * it, parsed, so tests assert on fields instead of output text.
 */
export function captureLogLines() {
  const lines: CapturedLogLine[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as CapturedLogLine);
      done();
    },
  });
  return { lines, stream };
}

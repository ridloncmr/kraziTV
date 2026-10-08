import type { Writable } from "node:stream";

const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const ESCAPE = "\u001b";
const BACKSPACES: ReadonlySet<string> = new Set(["\b", "\u007f"]);

/** The calls the prompt makes on a TTY stdin; a test passes a fake. */
interface TerminalInput {
  setRawMode(mode: boolean): unknown;
  setEncoding(encoding: "utf8"): unknown;
  resume(): unknown;
  pause(): unknown;
  on(
    event: "data" | "end" | "close",
    listener: (keys: string) => void,
  ): unknown;
  off(
    event: "data" | "end" | "close",
    listener: (keys: string) => void,
  ): unknown;
}

/** Thrown when the operator cancels a prompt or its input ends first. */
export class PromptCancelled extends Error {}

type KeysOutcome = "typing" | "submitted" | "cancelled";

/**
 * Applies one chunk of raw keys to what has been typed. Enter submits;
 * Ctrl+C, or Ctrl+D on an empty line, cancels; Backspace erases one
 * character. An escape sequence, such as an arrow key, ends the chunk: the
 * keys before it count and the sequence is never typed. Other control keys
 * are ignored.
 */
function applyKeys(typed: string[], keys: string): KeysOutcome {
  for (const key of keys) {
    if (key === ESCAPE) return "typing";
    if (key === "\r" || key === "\n") return "submitted";
    if (key === CTRL_C || (key === CTRL_D && typed.length === 0)) {
      return "cancelled";
    }
    if (BACKSPACES.has(key)) typed.pop();
    else if (key >= " ") typed.push(key);
  }
  return "typing";
}

/**
 * Reads one line from a terminal without echoing it, so a password never
 * appears on screen. Raw mode hands over every key, so this handles Enter,
 * Backspace, and Ctrl+C itself, the same way on Windows and POSIX terminals.
 * Input that ends before Enter cancels the prompt rather than leaving it
 * waiting forever. The terminal and its listeners are always restored.
 */
export function promptHidden(
  question: string,
  input: TerminalInput,
  output: Writable,
): Promise<string> {
  output.write(question);
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();

  return new Promise((resolve, reject) => {
    const typed: string[] = [];
    const finish = (outcome: "submitted" | "cancelled") => {
      input.off("data", onKeys);
      input.off("end", onEnd);
      input.off("close", onEnd);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      if (outcome === "submitted") resolve(typed.join(""));
      else reject(new PromptCancelled("The prompt was cancelled"));
    };
    const onKeys = (keys: string) => {
      const outcome = applyKeys(typed, keys);
      if (outcome !== "typing") finish(outcome);
    };
    const onEnd = () => finish("cancelled");
    input.on("data", onKeys);
    input.on("end", onEnd);
    input.on("close", onEnd);
  });
}

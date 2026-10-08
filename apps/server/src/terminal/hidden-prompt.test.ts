import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { FakeTerminalInput } from "../testing/fake-terminal-input.js";
import { PromptCancelled, promptHidden } from "./hidden-prompt.js";

/** Starts a prompt on a fake terminal and collects what it would print. */
function startPrompt() {
  const input = new FakeTerminalInput();
  const output = new PassThrough();
  let printed = "";
  output.on("data", (chunk: Buffer) => (printed += chunk.toString()));
  const answer = promptHidden("Password: ", input, output);
  return { input, answer, printed: () => printed };
}

describe("promptHidden", () => {
  it("returns what was typed without echoing it, and restores the terminal", async () => {
    const { input, answer, printed } = startPrompt();
    expect(input.rawMode).toBe(true);

    input.write("s3cr");
    input.write("ét!\r");

    await expect(answer).resolves.toBe("s3crét!");
    expect(printed()).toBe("Password: \n");
    expect(input.rawMode).toBe(false);
    expect(input.listenerCount("data")).toBe(0);
  });

  it.each([
    ["DEL", "\u007f"],
    ["BS", "\b"],
  ])("erases the last character on %s", async (_, backspace) => {
    const { input, answer } = startPrompt();

    input.write(`abc${backspace}${backspace}d\r`);

    await expect(answer).resolves.toBe("ad");
  });

  it("keeps the keys before an escape sequence and drops the sequence", async () => {
    const { input, answer } = startPrompt();

    input.write("ab\u001b[D");
    input.write("\u001b[A");
    input.write("c\r");

    await expect(answer).resolves.toBe("abc");
  });

  it("ignores other control keys", async () => {
    const { input, answer } = startPrompt();

    input.write("a\tb\u0001c\r");

    await expect(answer).resolves.toBe("abc");
  });

  it("cancels on Ctrl+C", async () => {
    const { input, answer } = startPrompt();

    input.write("abc\u0003");

    await expect(answer).rejects.toBeInstanceOf(PromptCancelled);
    expect(input.rawMode).toBe(false);
  });

  it("cancels on Ctrl+D only on an empty line", async () => {
    const typed = startPrompt();
    typed.input.write("ab\u0004c\r");
    await expect(typed.answer).resolves.toBe("abc");

    const empty = startPrompt();
    empty.input.write("\u0004");
    await expect(empty.answer).rejects.toBeInstanceOf(PromptCancelled);
  });

  it("cancels when input ends mid-prompt, and lets go of the stream", async () => {
    const { input, answer } = startPrompt();

    input.write("abc");
    input.end();

    await expect(answer).rejects.toBeInstanceOf(PromptCancelled);
    expect(input.rawMode).toBe(false);
    for (const event of ["data", "end", "close"]) {
      expect(input.listenerCount(event)).toBe(0);
    }
  });
});

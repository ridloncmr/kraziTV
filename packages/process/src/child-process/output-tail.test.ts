import { describe, expect, it } from "vitest";

import { OutputTail } from "./output-tail.js";

describe("OutputTail", () => {
  it("retains everything while under the limit", () => {
    const tail = new OutputTail(8);
    tail.append("abc");
    tail.append(Buffer.from("def"));

    expect(tail.bytes().toString()).toBe("abcdef");
    expect(tail.byteLength).toBe(6);
  });

  it("drops the oldest bytes across chunk boundaries", () => {
    const tail = new OutputTail(8);
    tail.append("abcde");
    tail.append("fghij");

    expect(tail.bytes().toString()).toBe("cdefghij");
    expect(tail.byteLength).toBe(8);
  });

  it("keeps only the end of a single oversized chunk", () => {
    const tail = new OutputTail(4);
    tail.append("early");
    tail.append(new Uint8Array(Buffer.from("0123456789")));

    expect(tail.bytes().toString()).toBe("6789");
  });

  it("copies chunks so later writes to a source buffer cannot change it", () => {
    const tail = new OutputTail(8);
    const source = Buffer.from("abc");
    tail.append(source);
    source.write("xyz");

    expect(tail.bytes().toString()).toBe("abc");
  });

  it("ignores empty chunks", () => {
    const tail = new OutputTail(8);
    tail.append("");

    expect(tail.byteLength).toBe(0);
    expect(tail.bytes()).toEqual(Buffer.alloc(0));
  });
});

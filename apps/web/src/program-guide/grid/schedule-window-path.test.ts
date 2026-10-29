import { expect, it } from "vitest";
import { scheduleWindowPath } from "./schedule-window-path.js";

it("requests an encoded channel and explicit UTC view window across midnight", () => {
  const url = new URL(
    scheduleWindowPath("channel/one", Date.parse("2026-10-05T23:30:00Z")),
    "http://ui.test",
  );
  expect(url.pathname).toBe("/channels/channel%2Fone/schedule");
  expect(url.searchParams.get("start")).toBe("2026-10-05T23:30:00.000Z");
  expect(url.searchParams.get("end")).toBe("2026-10-06T23:30:00.000Z");
});

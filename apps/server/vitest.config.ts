import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests that take about a second alone run several times slower while the
  // parallel suite competes with other work, so the 5s default reported
  // contention as failure. 15s still fails a genuine hang.
  test: { testTimeout: 15_000 },
});

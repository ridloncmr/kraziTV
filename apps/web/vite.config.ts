/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["src/testing/testing-library-setup.ts"],
    // jsdom tests that take about two seconds alone run several times slower
    // while the parallel suite competes with other work; the 5s default
    // reported contention as failure. 15s still fails a genuine hang.
    testTimeout: 15_000,
  },
});

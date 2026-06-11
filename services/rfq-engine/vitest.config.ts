import { defineConfig } from "vitest/config";

export default defineConfig({
  // Prevent vite from walking up and loading an unrelated postcss config
  css: { postcss: { plugins: [] } },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});

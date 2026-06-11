import { defineConfig } from "vitest/config";

export default defineConfig({
  // Prevent vite from walking up and loading the frontend repo's postcss config
  css: { postcss: { plugins: [] } },
  test: {
    include: ["test/**/*.test.ts"],
  },
});

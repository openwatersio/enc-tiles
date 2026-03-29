import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@enc-tiles/dai": resolve(__dirname, "../dai/src/index.ts"),
    },
  },
});

import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@enc-tiles/s52": resolve(__dirname, "../s52/src/index.ts"),
      "@enc-tiles/dai": resolve(__dirname, "../dai/src/index.ts"),
    },
  },
});

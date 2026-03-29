import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@enc-tiles/styles": resolve(__dirname, "packages/styles/src/index.ts"),
      "@enc-tiles/s52": resolve(__dirname, "packages/s52/src/index.ts"),
      "@enc-tiles/dai": resolve(__dirname, "packages/dai/src/index.ts"),
    },
  },
});

import { defineConfig } from "vite";

// The viewer is deployed to GitHub Pages under the repository subpath
// (e.g. https://openwatersio.github.io/enc-tiles/). The deploy workflow sets
// BASE_PATH to that subpath so assets resolve correctly; local dev defaults
// to "/".
export default defineConfig({
  base: process.env.BASE_PATH || "/",
});

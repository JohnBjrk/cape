import { defineConfig } from "../src/config/index.ts";

export default defineConfig({
  name: "cape",
  displayName: "Cape",
  version: "0.1.1",
  description: "Build, run, and manage Cape-based CLIs",
  entry: "main.ts",
  outfile: "cape",
  install: { type: "github", repo: "JohnBjrk/cape" },
});

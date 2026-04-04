import { defineConfig } from "../src/config/index.ts";

export default defineConfig({
  name: "cape",
  displayName: "Cape",
  version: "0.1.0",
  description: "Build, run, and manage Cape-based CLIs",
  entry: "main.ts",
  outfile: "cape",
  repository: "cape-sh/cape",
});

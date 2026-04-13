import { defineScenario } from "../helpers/runner.ts";

// Local-only scenario: tests cape build and cape build --all-platforms.
// Skipped in CI because Bun.build({ compile: true }) throws an ELF section
// error on linux/x64 when called from within a compiled binary, and bun is
// not available inside the container to fall back on.
// Runs fine locally on macOS (ARM64) where neither issue applies.
//
// Prerequisites:
//   bun run cape:build:all

export default defineScenario({
  name: "build",
  image: "debian:bookworm-slim",
  mounts: [
    { host: "cape-cli/dist", container: "/release" },
    { host: "tests/container/fixtures/install-local.sh", container: "/install-local.sh" },
  ],
  steps: [
    {
      name: "install-dependencies",
      run: "apt-get update -qq && apt-get install -y -qq curl",
    },
    {
      name: "install-cape",
      run: "sh /install-local.sh",
      expect: { stdout: "Installed cape to" },
    },
    {
      name: "init-a-project",
      run: `export PATH="$HOME/.cape/bin:$PATH" && cape init --name my-tool --yes`,
      expect: { stdout: "Created my-tool/" },
    },
    {
      name: "build-the-project",
      run: `export PATH="$HOME/.cape/bin:$PATH" && cd my-tool && cape build`,
      expect: { exitCode: 0 },
    },
    {
      name: "run-built-binary",
      run: `my-tool/dist/my-tool hello --name World`,
      expect: { stdout: "Hello, World!" },
    },
    {
      name: "build-all-platforms",
      // Verifies that Bun.build() accepts undocumented platform targets at runtime.
      // We can't run the non-native binaries, but we can confirm they were produced.
      run: `export PATH="$HOME/.cape/bin:$PATH" && cd my-tool && cape build --all-platforms`,
      expect: { exitCode: 0 },
    },
    {
      name: "all-platform-artifacts-exist",
      run: `ls my-tool/dist/my-tool-linux-arm64.gz my-tool/dist/my-tool-linux-x64.gz my-tool/dist/my-tool-darwin-arm64.gz my-tool/dist/my-tool-darwin-x64.gz`,
      expect: { exitCode: 0 },
    },
  ],
});

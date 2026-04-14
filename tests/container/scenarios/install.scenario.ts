import { defineScenario } from "../helpers/runner.ts";

// Prerequisites:
//   bun run cape:bootstrap:build:all
// This produces cape-cli/dist/cape-linux-arm64.gz, cape-cli/dist/cape-linux-x64.gz, cape-cli/dist/install.sh

export default defineScenario({
  name: "install-from-release",
  image: "debian:bookworm-slim",
  mounts: [
    { host: "cape-cli/dist", container: "/release" },
    {
      host: "tests/container/fixtures/install-local.sh",
      container: "/install-local.sh",
    },
  ],
  steps: [
    {
      name: "install-dependencies",
      // debian:bookworm-slim has gzip but not curl — install what the real
      // install.sh would need, to match a realistic end-user environment.
      run: "apt-get update -qq && apt-get install -y -qq curl",
    },
    {
      name: "install-from-script",
      run: "sh /install-local.sh",
      expect: { stdout: "Installed cape to" },
    },
    {
      name: "binary-is-on-path",
      run: `export PATH="$HOME/.cape/bin:$PATH" && cape --version`,
      expect: { stdout: /cape \d+\.\d+\.\d+/ },
    },
    {
      name: "binary-works-without-bun",
      // Verify bun is not on PATH — the binary must be fully self-contained
      run: `which bun && echo "FAIL: bun found in PATH" || echo "OK: bun not in PATH"`,
      expect: { stdout: "OK: bun not in PATH" },
    },
    {
      name: "init-a-project",
      run: `export PATH="$HOME/.cape/bin:$PATH" && cape init --name my-tool --yes`,
      expect: { stdout: "Created my-tool/" },
    },
    {
      name: "run-hello-command",
      run: `export PATH="$HOME/.cape/bin:$PATH" && cd my-tool && cape run -- hello --name World`,
      expect: { stdout: "Hello, World!" },
    },
  ],
});

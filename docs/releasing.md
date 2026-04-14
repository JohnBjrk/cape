# Releasing a new Cape version

## Overview

A Cape release involves three steps: prebuild → build → publish. The prebuild bundles the Cape framework source into the binary so user projects can bootstrap without installing Cape separately. Build produces compressed binaries for each platform. Publish creates a GitHub release and attaches them.

---

## 1. Bump the version

The version lives in one place:

```ts
// cape-cli/cli.config.ts
version: "0.1.2",
```

`package.json` has its own `version` field but it is not used in the build or publish process — only `cli.config.ts` matters.

---

## Fresh clone setup

The four generated files are gitignored. Placeholder versions (empty exports with correct types) are committed so the project compiles, but they must be populated before building:

```sh
bun run cape:bootstrap:prebuild   # if cape binary not yet available
# or, once cape is built:
cape prebuild
```

If the files were previously tracked by git, untrack them once:

```sh
git rm --cached src/embedded.ts src/embedded-docs.ts \
  cape-cli/src/embedded.ts cape-cli/src/embedded-guide.ts
```

---

## 2. Prebuild

The prebuild step regenerates the embedded files that get baked into the binary:

| Generated file | Contents |
|---|---|
| `cape-cli/src/embedded.ts` | `CAPE_BUNDLE` (full Cape runtime) + `CAPE_TYPES` (public .d.ts) |
| `src/embedded.ts` | `CAPE_TYPES` (used by `plugin init`) |
| `src/embedded-docs.ts` | `FRAMEWORK_DOCS` (API reference markdown, shown in all tools' `docs serve`) |
| `cape-cli/src/embedded-guide.ts` | `GUIDE_DOCS` (Cape guide markdown, shown only in `cape docs serve`) |

Run with Cape itself (preferred):

```sh
cape prebuild
```

If the cape binary is unavailable or broken, use the bootstrap fallback:

```sh
bun run cape:bootstrap:prebuild
```

> **Keep these in sync.** `cape-cli/plugins/prebuild/prebuild.ts` (the `cape prebuild` command) and `cape-cli/scripts/prebuild.ts` (the bootstrap script) do the same thing and must always match. If you change one, change the other.

---

## 3. Build

Build compressed binaries for all platforms:

```sh
cape build --all-platforms
```

This produces four `.gz` binaries and an `install.sh` in `cape-cli/dist/`:

```
cape-cli/dist/
├── cape-darwin-arm64.gz
├── cape-darwin-x64.gz
├── cape-linux-arm64.gz
├── cape-linux-x64.gz
└── install.sh          ← version is hardcoded at build time
```

The version string in `install.sh` and in each binary comes from `cli.config.ts` at build time — it cannot be changed after building.

To test locally before publishing, install the current-platform binary:

```sh
bun run cape:install   # copies dist/cape to ~/.cape/bin/cape
cape --version         # should match cli.config.ts
```

---

## 4. Publish

```sh
cape publish
```

What this does:

1. Checks that `gh` is installed and authenticated (`gh auth status`)
2. Verifies the built binary's `--version` output matches `cli.config.ts`
3. Checks that git tag `v{VERSION}` does not already exist
4. Prompts for confirmation (skip with `--yes`)
5. Creates a GitHub release at `JohnBjrk/cape` tagged `v{VERSION}` with auto-generated release notes
6. Attaches all `.gz` binaries and `install.sh` as release assets

Use `--draft` to create a draft release for review before making it public:

```sh
cape publish --draft
```

---

## Full checklist

```sh
# 1. Bump version
#    Edit cape-cli/cli.config.ts → version: "x.y.z"

# 2. Prebuild
cape prebuild

# 3. Build all platforms
cape build --all-platforms

# 4. Smoke-test locally
bun run cape:install
cape --version

# 5. Publish
cape publish
```

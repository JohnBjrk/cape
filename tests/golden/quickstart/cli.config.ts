import { defineConfig, defineConfigSchema, defineCommandConfig, typedWith } from "cape";
import type { RuntimeWith, ConfigField, ConfigSchema } from "cape";

// Declare top-level config keys here (available as runtime.config in all commands).
// Example: apiUrl: { type: "string", description: "Base API URL" }
const globalConfig = defineConfigSchema({});

export default defineConfig({
  name: "my-tool",
  displayName: "My Tool",
  version: "0.1.0",
  description: "A CLI built with Cape",
  config: globalConfig,
});

// Import defineCommand / defineSubcommand / defineCommandConfig from here instead of
// "cape" to get runtime.config typed from the schema above.
export const { defineCommand, defineSubcommand } = typedWith<typeof globalConfig>();
export { defineCommandConfig };

// CommandRuntime<CC> — typed runtime for built-in commands.
// Use as the type for runtime parameters when passing to helper classes/functions.
export type CommandRuntime<CC extends ConfigSchema = Record<never, ConfigField>> = RuntimeWith<
  CC,
  typeof globalConfig
>;

// ---------------------------------------------------------------------------
// Config file reference (.my-tool.toml or ~/.config/my-tool/config.toml)
// ---------------------------------------------------------------------------
//
// Top-level keys mirror the globalConfig schema above.
//
// Framework settings live under [my-tool] — reserved, never exposed to commands:
//   [my-tool]
//   pluginDirs = ["./extra-plugins", "~/shared-plugins"]
//
// Command config lives under the command name:
//   [my-command]
//   someOption = "value"

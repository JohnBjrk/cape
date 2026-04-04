import { defineCommand } from "../../src/cli.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { refreshCapeModule } from "./helpers.ts";

export const updateCommand = defineCommand({
  name: "update",
  description: "Update node_modules/cape/ with the runtime and types from this cape binary",
  async run(_args, runtime) {
    const cwd = process.cwd();
    const configPath = join(cwd, "cli.config.ts");

    if (!existsSync(configPath)) {
      runtime.printError("Error: no cli.config.ts found in the current directory.");
      runtime.printError("Run `cape init --name <name>` to create a new Cape project.");
      runtime.exit(1);
    }

    await runtime.output.withSpinner("Updating node_modules/cape/...", async (spinner) => {
      await refreshCapeModule(cwd);
      spinner.succeed("node_modules/cape/ updated");
    });

    runtime.print("");
    runtime.print("Types and runtime are now in sync with this cape binary.");
    runtime.print("Restart your editor's TypeScript language server to pick up the new types.");
  },
});

import { createCli } from "../src/cli.ts";
import { initCommand } from "./commands/init.ts";
import { runCommand } from "./commands/run.ts";
import { buildCommand } from "./commands/build.ts";
import { commandCommand } from "./commands/command.ts";
import { linkCommand } from "./commands/link.ts";
import { installBinaryCommand } from "./commands/install-binary.ts";
import { publishCommand } from "./commands/publish.ts";
import { updateCommand } from "./commands/update.ts";
import config from "./cli.config.ts";

// Cape is itself a Cape-based CLI — dogfooding the framework.
const cli = createCli(config, [
  initCommand,
  runCommand,
  buildCommand,
  commandCommand,
  linkCommand,
  installBinaryCommand,
  publishCommand,
  updateCommand,
]);

await cli.run();

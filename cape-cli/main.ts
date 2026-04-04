import { createCli } from "../src/cli.ts";
import { initCommand } from "./commands/init.ts";
import { runCommand } from "./commands/run.ts";
import { buildCommand } from "./commands/build.ts";
import { commandCommand } from "./commands/command.ts";
import config from "./cli.config.ts";

// Cape is itself a Cape-based CLI — dogfooding the framework.
const cli = createCli(config, [
  initCommand,
  runCommand,
  buildCommand,
  commandCommand,
]);

await cli.run();

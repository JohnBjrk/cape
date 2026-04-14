import { createCli } from "cape";
import config from "./cli.config.ts";
import { helloCommand } from "./commands/hello.ts";
import { greetCommand } from "./commands/greet.ts";

const cli = createCli(config, [helloCommand, greetCommand]);

await cli.run();

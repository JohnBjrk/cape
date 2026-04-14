import { createCli } from "cape";
import config from "./cli.config.ts";
import { helloCommand } from "./commands/hello.ts";

const cli = createCli(config, [helloCommand]);

await cli.run();

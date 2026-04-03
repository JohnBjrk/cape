import { defineCommand } from "../../../src/cli.ts";

export default defineCommand({
  name: "wave",
  description: "Wave at someone (loaded as a plugin)",
  schema: {
    flags: {
      name: { type: "string", alias: "n", required: true, description: "Who to wave at" },
    },
  },
  async run(args, runtime) {
    runtime.print(`👋 Hey, ${args.flags.name}!`);
  },
});

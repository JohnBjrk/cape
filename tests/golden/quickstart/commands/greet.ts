import { defineCommand } from "../cli.config.ts";

export const greetCommand = defineCommand({
  name: "greet",
  description: "Greet someone",
  schema: {
    flags: {
      // TODO: add flags
      // example: { type: "string", alias: "e", required: true, description: "An example flag" },
    },
  },
  async run(args, runtime) {
    // TODO: implement greet
    runtime.print("Running greet...");
  },
});

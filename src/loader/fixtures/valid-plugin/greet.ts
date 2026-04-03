import { defineCommand } from "../../../cli.ts";

export default defineCommand({
  name: "greet",
  description: "Greet someone",
  schema: {
    flags: {
      name: { type: "string", required: true, description: "Who to greet" },
    },
  },
  async run(args, runtime) {
    runtime.print(`Hello, ${args.flags.name}!`);
  },
});

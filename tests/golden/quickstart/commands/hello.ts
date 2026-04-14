import { defineCommand } from "../cli.config.ts";

export const helloCommand = defineCommand({
  name: "hello",
  description: "Say hello",
  schema: {
    flags: {
      name: {
        type: "string",
        alias: "n",
        required: true,
        description: "Who to greet",
      },
    },
  },
  async run(args, runtime) {
    runtime.print(`Hello, ${args.flags.name}!`);
  },
});

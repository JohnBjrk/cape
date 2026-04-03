import { createCli, defineCommand, defineSubcommand } from "../src/cli.ts";
import config from "./cli.config.ts";

const cli = createCli(
  config,
  [
    defineCommand({
      name: "hello",
      description: "Say hello to someone",
      schema: {
        flags: {
          name:   { type: "string",  alias: "n", required: true, description: "Who to greet" },
          shout:  { type: "boolean", alias: "s",                 description: "SHOUT the greeting" },
          repeat: { type: "number",              default: 1,      description: "How many times to repeat" },
        },
      },
      async run(args, runtime) {
        // No casts — types flow from the schema above
        for (let i = 0; i < args.flags.repeat; i++) {
          const msg = `Hello, ${args.flags.name}!`;
          runtime.print(args.flags.shout ? msg.toUpperCase() : msg);
        }
      },
    }),

    defineCommand({
      name: "farewell",
      description: "Say goodbye",
      subcommands: [
        defineSubcommand({
          name: "wave",
          description: "Wave goodbye to someone",
          schema: {
            flags: {
              name: { type: "string", alias: "n", required: true, description: "Who to wave to" },
            },
          },
          async run(args, runtime) {
            runtime.print(`Goodbye, ${args.flags.name}! 👋`);
          },
        }),
        defineSubcommand({
          name: "bow",
          description: "Bow farewell to someone",
          schema: {
            flags: {
              name: { type: "string", alias: "n", required: true, description: "Who to bow to" },
            },
          },
          async run(args, runtime) {
            runtime.print(`Farewell, ${args.flags.name}. 🎩`);
          },
        }),
      ],
    }),
  ],
);

await cli.run();

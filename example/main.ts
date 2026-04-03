import { createCli } from "../src/cli.ts";

const cli = createCli(
  { name: "greet", version: "0.1.0", description: "A greeting CLI built on Cape" },
  [
    {
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
        const name   = args.flags.name as string;
        const shout  = args.flags.shout as boolean;
        const repeat = args.flags.repeat as number;

        for (let i = 0; i < repeat; i++) {
          let msg = `Hello, ${name}!`;
          if (shout) msg = msg.toUpperCase();
          runtime.print(msg);
        }
      },
    },
    {
      name: "farewell",
      description: "Say goodbye",
      subcommands: [
        {
          name: "wave",
          description: "Wave goodbye to someone",
          schema: {
            flags: {
              name: { type: "string", alias: "n", required: true, description: "Who to wave to" },
            },
          },
          async run(args, runtime) {
            runtime.print(`Goodbye, ${args.flags.name as string}! 👋`);
          },
        },
        {
          name: "bow",
          description: "Bow farewell to someone",
          schema: {
            flags: {
              name: { type: "string", alias: "n", required: true, description: "Who to bow to" },
            },
          },
          async run(args, runtime) {
            runtime.print(`Farewell, ${args.flags.name as string}. 🎩`);
          },
        },
      ],
    },
  ],
);

await cli.run();

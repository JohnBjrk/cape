import { createCli, defineCommand, defineSubcommand } from "../src/cli.ts";
import { text, select, confirm, multiSelect, autocomplete } from "../src/prompt/index.ts";
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

    defineCommand({
      name: "demo",
      description: "Demonstrate interactive prompt types",
      subcommands: [

        defineSubcommand({
          name: "text",
          description: "Free-text input with cursor editing",
          async run(_args, runtime) {
            const name = await text({
              message: "What is your name?",
              default: "World",
              validate: (v) => v.trim().length === 0 ? "Name cannot be empty" : undefined,
            });
            runtime.print(`Hello, ${name}!`);
          },
        }),

        defineSubcommand({
          name: "select",
          description: "Pick one item from a list (arrow keys)",
          async run(_args, runtime) {
            const colour = await select({
              message: "Pick a colour",
              choices: ["red", "green", "blue", "yellow", "purple"],
              default: "blue",
            });
            runtime.print(`You picked: ${colour}`);
          },
        }),

        defineSubcommand({
          name: "confirm",
          description: "Yes/no confirmation",
          async run(_args, runtime) {
            const ok = await confirm({
              message: "Are you sure you want to continue?",
              default: false,
            });
            runtime.print(ok ? "Continuing!" : "Aborted.");
          },
        }),

        defineSubcommand({
          name: "multi-select",
          description: "Pick multiple items (Space to toggle, a for all)",
          async run(_args, runtime) {
            const toppings = await multiSelect({
              message: "Choose your toppings",
              choices: ["cheese", "pepperoni", "mushrooms", "onions", "peppers", "olives"],
              defaults: ["cheese"],
            });
            if (toppings.length === 0) {
              runtime.print("Plain pizza it is.");
            } else {
              runtime.print(`Pizza with: ${toppings.join(", ")}`);
            }
          },
        }),

        defineSubcommand({
          name: "autocomplete",
          description: "Fuzzy-filter a list as you type",
          async run(_args, runtime) {
            const countries = [
              "Afghanistan", "Albania", "Algeria", "Argentina", "Australia",
              "Austria", "Belgium", "Bolivia", "Brazil", "Canada", "Chile",
              "China", "Colombia", "Croatia", "Czech Republic", "Denmark",
              "Ecuador", "Egypt", "Finland", "France", "Germany", "Greece",
              "Hungary", "India", "Indonesia", "Iran", "Iraq", "Ireland",
              "Israel", "Italy", "Japan", "Jordan", "Kenya", "Malaysia",
              "Mexico", "Morocco", "Netherlands", "New Zealand", "Nigeria",
              "Norway", "Pakistan", "Peru", "Philippines", "Poland",
              "Portugal", "Romania", "Russia", "Saudi Arabia", "South Africa",
              "South Korea", "Spain", "Sweden", "Switzerland", "Thailand",
              "Turkey", "Ukraine", "United Kingdom", "United States",
              "Venezuela", "Vietnam",
            ];
            const country = await autocomplete({
              message: "Search for a country",
              choices: countries,
            });
            runtime.print(`Selected: ${country}`);
          },
        }),

        defineSubcommand({
          name: "autocomplete-dynamic",
          description: "Autocomplete with a simulated async API fetch",
          async run(_args, runtime) {
            const env = await autocomplete({
              message: "Select an environment",
              debounceMs: 300,
              choices: async (query, signal) => {
                // Simulate a slow API call
                await new Promise((res) => setTimeout(res, 400));
                if (signal.aborted) return [];
                const all = ["production", "staging", "development", "preview", "sandbox"];
                return query ? all.filter((e) => e.includes(query.toLowerCase())) : all;
              },
            });
            runtime.print(`Deploying to: ${env}`);
          },
        }),

      ],
    }),

  ],
);

await cli.run();

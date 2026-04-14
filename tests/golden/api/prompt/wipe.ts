import { defineCommand } from "../cli.config.ts";

export const wipeCommand = defineCommand({
  name: "wipe",
  description: "Delete all data in an environment",
  schema: {
    flags: {
      env:   { type: "string",  required: true, description: "Target environment" },
      force: { type: "boolean", prompt: true,   description: "Confirm deletion" },
    },
  },
  async run(args, runtime) {
    if (!args.flags.force) {
      runtime.print("Aborted.");
      return;
    }
    runtime.output.success(`Wiped ${args.flags.env}`);
  },
});

import { defineCommand } from "../cli.config.ts";

export const releaseCommand = defineCommand({
  name: "release",
  description: "Release to an environment",
  schema: {
    flags: {
      env: {
        type: "string",
        required: true,
        description: "Target environment",
        complete: {
          type: "static",
          values: ["development", "staging", "production"],
        },
      },
    },
  },
  async run(args, runtime) {
    runtime.output.success(`Released to ${args.flags.env}`);
  },
});

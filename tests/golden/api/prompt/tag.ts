import { defineCommand } from "../cli.config.ts";

export const tagCommand = defineCommand({
  name: "tag",
  description: "Apply labels to a service",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Target service" },
      label:   { type: "string", multiple: true, description: "Labels to apply (repeatable)" },
    },
  },
  async run(args, runtime) {
    const labels = args.provided.has("label")
      ? args.flags.label
      : await runtime.prompt.multiSelect({
          message: "Select labels to apply",
          choices: ["stable", "canary", "deprecated", "internal", "public", "beta"],
        });

    if (labels.length === 0) {
      runtime.print("No labels applied.");
      return;
    }
    runtime.output.success(`Applied to ${args.flags.service}: ${labels.join(", ")}`);
  },
});

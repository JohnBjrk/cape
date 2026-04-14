import { defineCommand } from "../cli.config.ts";

export const createCommand = defineCommand({
  name: "create",
  description: "Create a new service",
  schema: {
    flags: {
      name: { type: "string", description: "Service name" },
    },
  },
  async run(args, runtime) {
    const name = args.flags.name ?? await runtime.prompt.text({
      message: "Service name",
      validate: (v) => {
        if (!v.trim()) return "Name cannot be empty";
        if (!/^[a-z][a-z0-9-]*$/.test(v)) return "Use lowercase letters, numbers, and hyphens";
      },
    });
    runtime.output.success(`Created service "${name}"`);
  },
});

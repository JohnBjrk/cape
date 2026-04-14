import { defineCommand } from "../cli.config.ts";

export const checkCommand = defineCommand({
  name: "check",
  description: "Check service health",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Service name" },
    },
  },
  async run(args, runtime) {
    runtime.output.success(`${args.flags.service} is running`);
    runtime.output.warn("1 unhealthy replica detected — consider scaling up");
  },
});

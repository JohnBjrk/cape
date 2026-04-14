import { defineCommand } from "../cli.config.ts";

export const infoCommand = defineCommand({
  name: "info",
  description: "Show service details",
  schema: {
    flags: {
      service: { type: "string", required: true, description: "Service name" },
    },
  },
  async run(args, runtime) {
    runtime.output.json({
      name: args.flags.service,
      status: "running",
      version: "1.4.2",
      uptime: "3d 14h",
    });
  },
});

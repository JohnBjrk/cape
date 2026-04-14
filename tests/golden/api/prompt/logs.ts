import { defineCommand } from "../cli.config.ts";

export const logsCommand = defineCommand({
  name: "logs",
  description: "Tail logs for a service",
  schema: {
    flags: {
      service: { type: "string", description: "Service name" },
    },
  },
  async run(args, runtime) {
    const service = args.flags.service ?? await runtime.prompt.autocomplete({
      message: "Service",
      choices: async (query, signal) => {
        // In production this would fetch from an API
        const all = ["api-gateway", "auth-service", "billing", "data-pipeline", "frontend"];
        return all.filter((s) => s.includes(query));
      },
    });
    runtime.output.success(`Tailing logs for ${service}...`);
  },
});

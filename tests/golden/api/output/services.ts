import { defineCommand } from "../cli.config.ts";

export const servicesCommand = defineCommand({
  name: "services",
  description: "List running services",
  async run(_args, runtime) {
    runtime.output.table([
      { Name: "api",      Status: "running", Replicas: 3 },
      { Name: "worker",   Status: "stopped", Replicas: 0 },
      { Name: "frontend", Status: "running", Replicas: 2 },
    ]);
    runtime.print("");
    runtime.output.list(["api", "worker", "frontend"]);
  },
});
